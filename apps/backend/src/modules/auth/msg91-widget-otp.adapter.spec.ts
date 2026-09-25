import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv, type Env } from '../../config/env';
import { ExternalCallPolicy } from '../../common/http/external-call.policy';
import { MetricsService } from '../../common/observability/metrics.service';
import { Msg91WidgetOtpAdapter } from './msg91-widget-otp.adapter';
import { otpMatches } from './otp-delivery';
import type { OtpPort } from './otp.port';
import { digest } from './otp.util';

/**
 * MSG91's OTP Widget against a faked `fetch`: the requests match what MSG91's
 * own SDK sends, MSG91's reqId comes back as the vendor reference, and a code
 * is only accepted when MSG91 says so.
 */

function envWith(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    ...process.env,
    OTP_PROVIDER: 'msg91_widget',
    MSG91_WIDGET_ID: 'widget-123',
    MSG91_WIDGET_TOKEN: 'token-abc',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

function build(env: Env) {
  return new Msg91WidgetOtpAdapter(env, new ExternalCallPolicy(env, new MetricsService(env)));
}

function reply(body: object, status = 200) {
  return new Response(JSON.stringify(body), { status });
}

function sent(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const [url, init] = fetchMock.mock.calls[call] as unknown as [string, RequestInit];
  return { url, body: JSON.parse(init.body as string) as Record<string, string> };
}

describe('Msg91WidgetOtpAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('asks MSG91 to send, as its SDK does, and returns the reqId as the reference', async () => {
    const fetchMock = vi.fn(async () => reply({ type: 'success', message: 'req-777' }));
    vi.stubGlobal('fetch', fetchMock);

    const receipt = await build(envWith()).send('+919876543210', '000000', 'customer_login');

    expect(receipt).toEqual({ vendorRef: 'req-777' });
    const { url, body } = sent(fetchMock);
    expect(url).toBe('https://control.msg91.com/api/v5/widget/sendOtpMobile');
    // Our own code is never sent: MSG91 makes the code.
    expect(body).toEqual({
      widgetId: 'widget-123',
      tokenAuth: 'token-abc',
      identifier: '919876543210',
    });
  });

  it('fails the send when MSG91 refuses it', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ type: 'error', message: 'Invalid token' }, 401)),
    );
    await expect(build(envWith()).send('+919876543210', '0', 'customer_login')).rejects.toThrow(
      'Invalid token',
    );
  });

  it('accepts a code only when MSG91 says success', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(reply({ type: 'success', message: 'jwt-access-token' }))
      .mockResolvedValueOnce(reply({ type: 'error', message: 'OTP not match' }, 400));
    vi.stubGlobal('fetch', fetchMock);
    const adapter = build(envWith());

    expect(await adapter.verify('req-777', '482913')).toBe(true);
    expect(await adapter.verify('req-777', '111111')).toBe(false);

    const { url, body } = sent(fetchMock);
    expect(url).toBe('https://control.msg91.com/api/v5/widget/verifyOtp');
    expect(body).toEqual({
      widgetId: 'widget-123',
      tokenAuth: 'token-abc',
      reqId: 'req-777',
      otp: '482913',
    });
  });

  it('throws (the login fails) when MSG91 is unreachable, rather than calling the code wrong', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => reply({ message: 'down' }, 503)),
    );
    await expect(build(envWith()).verify('req-777', '482913')).rejects.toThrow();
  });

  it('refuses to call MSG91 when it is not configured', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      build(envWith({ MSG91_WIDGET_TOKEN: '' })).send('+919876543210', '0', 'customer_login'),
    ).rejects.toThrow('not configured');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('otpMatches', () => {
  const ours = { codeHash: digest('123456'), vendorRef: null };

  it('checks a code we made against its digest', async () => {
    const port: OtpPort = { send: async () => {} };
    expect(await otpMatches(port, ours, '123456')).toBe(true);
    expect(await otpMatches(port, ours, '654321')).toBe(false);
  });

  it('asks the vendor about a code the vendor made, and never uses the digest for it', async () => {
    const verify = vi.fn(async (_ref: string, code: string) => code === '482913');
    const port: OtpPort = { send: async () => ({ vendorRef: 'req-1' }), verify };
    const row = { codeHash: digest('123456'), vendorRef: 'req-1' };

    expect(await otpMatches(port, row, '482913')).toBe(true);
    // Our (unused) generated code must not unlock a vendor-made challenge.
    expect(await otpMatches(port, row, '123456')).toBe(false);
    expect(verify).toHaveBeenCalledWith('req-1', '482913');
  });

  it('refuses a vendor-made code when the current provider cannot check it', async () => {
    const port: OtpPort = { send: async () => {} };
    expect(await otpMatches(port, { codeHash: digest('1'), vendorRef: 'req-1' }, '1')).toBe(false);
  });
});

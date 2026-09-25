import type Redis from 'ioredis';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { assertProductionSafety, loadEnv, type Env } from '../../config/env';
import { ExternalCallPolicy } from '../../common/http/external-call.policy';
import { MetricsService } from '../../common/observability/metrics.service';
import { devOtpKey } from './dev-otp.adapter';
import { Msg91OtpAdapter } from './msg91-otp.adapter';

/**
 * The MSG91 login-code adapter against a faked `fetch`: what it sends, that a
 * rejected send fails the login instead of pretending, and the echo that a demo
 * server needs. No request ever leaves the machine.
 */

function envWith(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    ...process.env,
    OTP_PROVIDER: 'msg91',
    MSG91_AUTH_KEY: 'test-auth-key',
    MSG91_OTP_TEMPLATE_ID: 'tmpl-otp-1',
    AUTH_DEV_OTP_ECHO: 'false',
    ...overrides,
  } as NodeJS.ProcessEnv);
}

function fakeRedis() {
  const store = new Map<string, string>();
  return {
    store,
    redis: {
      set: vi.fn(async (key: string, value: string) => {
        store.set(key, value);
        return 'OK';
      }),
      get: vi.fn(async (key: string) => store.get(key) ?? null),
    } as unknown as Redis,
  };
}

function build(env: Env) {
  const { store, redis } = fakeRedis();
  const policy = new ExternalCallPolicy(env, new MetricsService(env));
  return { store, adapter: new Msg91OtpAdapter(env, redis, policy) };
}

function ok(body: object = { type: 'success', request_id: 'req-1' }) {
  return new Response(JSON.stringify(body), { status: 200 });
}

describe('Msg91OtpAdapter', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends the code through the Flow API with the OTP template, the number without its +', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const { adapter } = build(envWith());

    await adapter.send('+919876543210', '482913', 'customer_login');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://control.msg91.com/api/v5/flow');
    expect((init.headers as Record<string, string>).authkey).toBe('test-auth-key');
    expect(JSON.parse(init.body as string)).toEqual({
      template_id: 'tmpl-otp-1',
      short_url: '0',
      recipients: [{ mobiles: '919876543210', otp: '482913' }],
    });
  });

  it('puts the code in the variable the template names', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const { adapter } = build(envWith({ MSG91_OTP_VAR: 'code' }));

    await adapter.send('+919876543210', '111222', 'customer_login');

    const body = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as string,
    );
    expect(body.recipients[0]).toEqual({ mobiles: '919876543210', code: '111222' });
  });

  it('fails the send when MSG91 rejects it, without retrying a rejection', async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ type: 'error', message: 'Invalid template' }), {
          status: 400,
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { adapter } = build(envWith());

    await expect(adapter.send('+919876543210', '482913', 'customer_login')).rejects.toThrow(
      'Invalid template',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('fails the send when MSG91 answers 200 with type "error"', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok({ type: 'error', message: 'Insufficient balance' })),
    );
    const { adapter } = build(envWith());

    await expect(adapter.send('+919876543210', '482913', 'customer_login')).rejects.toThrow(
      'Insufficient balance',
    );
  });

  it('refuses to send, and says why, when it is not configured', async () => {
    const fetchMock = vi.fn(async () => ok());
    vi.stubGlobal('fetch', fetchMock);
    const { adapter } = build(envWith({ MSG91_OTP_TEMPLATE_ID: '' }));

    await expect(adapter.send('+919876543210', '482913', 'customer_login')).rejects.toThrow(
      'MSG91 is not configured',
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the code for the on-screen echo only when the echo is on', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ok()),
    );

    const off = build(envWith());
    await off.adapter.send('+919876543210', '482913', 'customer_login');
    expect(off.store.size).toBe(0);
    expect(await off.adapter.lastIssued('+919876543210')).toBeNull();

    const on = build(envWith({ AUTH_DEV_OTP_ECHO: 'true' }));
    await on.adapter.send('+919876543210', '482913', 'customer_login');
    expect(on.store.get(devOtpKey('+919876543210'))).toBe('482913');
    expect(await on.adapter.lastIssued('+919876543210')).toBe('482913');
  });

  it('is refused at production boot without its template, and allowed with it', () => {
    // The minimal production-valid env the other production-safety specs use.
    const production = {
      NODE_ENV: 'production',
      AUTH_DEV_OTP_ECHO: 'false',
      JWT_ACCESS_SECRET: 'x'.repeat(48),
      FILE_SIGNING_SECRET: 'y'.repeat(48),
      PAYOUT_PROVIDER: 'razorpay_route',
      PAYOUT_WEBHOOK_SECRET: 'z'.repeat(32),
      PAYMENT_GATEWAY: 'razorpay',
      PAYMENT_WEBHOOK_SECRET: 'y'.repeat(32),
      RAZORPAY_KEY_ID: 'rzp_live_x',
      RAZORPAY_KEY_SECRET: 'secret',
      PUBLIC_TRACK_BASE_URL: 'https://towing.app',
      TELEPHONY_PROVIDER: 'exotel',
      EXOTEL_SID: 'sid',
      EXOTEL_TOKEN: 'token',
      ADMIN_TOTP_ENC_KEY: 'a-real-production-totp-encryption-key-32ch',
    };
    expect(() =>
      assertProductionSafety(envWith({ ...production, MSG91_OTP_TEMPLATE_ID: '' })),
    ).toThrow(/MSG91_OTP_TEMPLATE_ID/);
    expect(() => assertProductionSafety(envWith(production))).not.toThrow();
  });
});

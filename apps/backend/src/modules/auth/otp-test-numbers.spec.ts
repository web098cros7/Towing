import { describe, expect, it, vi } from 'vitest';
import { TestNumberOtpRouter } from './otp-test-numbers';
import type { OtpPort } from './otp.port';

describe('TestNumberOtpRouter', () => {
  function ports() {
    const dev: OtpPort = { send: vi.fn(async () => {}), lastIssued: vi.fn(async () => '123456') };
    const real: OtpPort = {
      send: vi.fn(async () => ({ vendorRef: 'req-1' })),
      verify: vi.fn(async () => true),
    };
    return { dev, real, router: new TestNumberOtpRouter(dev, real, ['+919845100003']) };
  }

  it('never sends a test number a real SMS', async () => {
    const { dev, real, router } = ports();
    expect(await router.send('+919845100003', '123456', 'driver_login')).toBeUndefined();
    expect(dev.send).toHaveBeenCalledOnce();
    expect(real.send).not.toHaveBeenCalled();
    expect(await router.lastIssued('+919845100003')).toBe('123456');
  });

  it('sends everyone else through the real provider, which alone verifies', async () => {
    const { dev, real, router } = ports();
    expect(await router.send('+919812345678', '000000', 'customer_login')).toEqual({
      vendorRef: 'req-1',
    });
    expect(real.send).toHaveBeenCalledOnce();
    expect(dev.send).not.toHaveBeenCalled();
    expect(await router.verify?.('req-1', '482913')).toBe(true);
    expect(await router.lastIssued('+919812345678')).toBeNull();
  });
});

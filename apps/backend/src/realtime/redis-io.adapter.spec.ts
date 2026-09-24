import { describe, expect, it } from 'vitest';
import { isAllowedOrigin, socketOrigin } from './redis-io.adapter';

describe('socket handshake origin', () => {
  const own = socketOrigin('http://192.168.1.6:4100');

  it('lets the phone apps in: they send the gateway URL as their origin', () => {
    expect(own).toBe('http://192.168.1.6:4100');
    expect(isAllowedOrigin('http://192.168.1.6:4100', ['http://localhost:3000'], own)).toBe(true);
    expect(socketOrigin('wss://api.mitow.in')).toBe('https://api.mitow.in');
  });

  it('keeps the console origins and no-origin clients', () => {
    expect(isAllowedOrigin('http://localhost:3000', ['http://localhost:3000'], own)).toBe(true);
    expect(isAllowedOrigin(undefined, [], own)).toBe(true);
  });

  it('refuses any other page', () => {
    expect(isAllowedOrigin('https://evil.example', ['http://localhost:3000'], own)).toBe(false);
    expect(isAllowedOrigin('https://evil.example', [], null)).toBe(false);
  });
});

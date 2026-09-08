/** Shared helpers for mock data sources (mirrors the mobile apps' pattern). */
type MockState = '' | 'empty' | 'error';

export const mockDelay = (ms = 450) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Resolves mock data honouring the per-feature dev override so every §10.9
 * feedback state (loading/empty/error) can be previewed without a backend.
 */
export async function resolveMock<T>(state: MockState, data: T, emptyValue: T): Promise<T> {
  await mockDelay();
  if (state === 'error') {
    throw new Error('Mock error state (forced via env)');
  }
  return state === 'empty' ? emptyValue : data;
}

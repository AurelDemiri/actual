import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mock jws to avoid needing real RSA keys
vi.mock('jws', () => ({
  sign: vi.fn(({ header, payload }) => {
    return `${JSON.stringify(header)}.${JSON.stringify(payload)}.mock-signature`;
  }),
}));

import { sign } from 'jws';

import { getJWT } from '../jwt';

describe('getJWT', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it('should call jws.sign with correct header', () => {
    getJWT('my-app-id', 'my-secret-key');

    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        header: {
          typ: 'JWT',
          alg: 'RS256',
          kid: 'my-app-id',
        },
      }),
    );
  });

  it('should include correct payload fields', () => {
    getJWT('my-app-id', 'my-secret-key');

    const callArgs = vi.mocked(sign).mock.calls[0][0];
    const payload = callArgs.payload as Record<string, unknown>;

    expect(payload.iss).toBe('enablebanking.com');
    expect(payload.aud).toBe('api.enablebanking.com');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    expect((payload.exp as number) - (payload.iat as number)).toBe(3600);
  });

  it('should use custom expiry', () => {
    getJWT('my-app-id', 'my-secret-key', 7200);

    const callArgs = vi.mocked(sign).mock.calls[0][0];
    const payload = callArgs.payload as Record<string, unknown>;

    expect((payload.exp as number) - (payload.iat as number)).toBe(7200);
  });

  it('should pass the secret key to jws.sign', () => {
    getJWT('my-app-id', 'my-secret-key');

    expect(sign).toHaveBeenCalledWith(
      expect.objectContaining({
        secret: 'my-secret-key',
      }),
    );
  });

  it('should return a string', () => {
    const result = getJWT('my-app-id', 'my-secret-key');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });
});

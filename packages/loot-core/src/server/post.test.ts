// @ts-strict-ignore
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Unmock the post module since setup.ts mocks it globally
vi.unmock('./post');

// Mock the fetch dependency before importing post
vi.mock('../platform/server/fetch', () => ({
  fetch: vi.fn(),
}));

// Mock the logger dependency
vi.mock('../platform/server/log', () => ({
  logger: { log: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('../shared/platform', () => ({
  isBrowser: false,
}));

import { fetch } from '../platform/server/fetch';
import { PostError } from './errors';
import { post } from './post';

function makeOkResponse(data: unknown) {
  const body = JSON.stringify({ status: 'ok', data });
  return {
    ok: true,
    status: 200,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'content-type' ? 'application/json' : null,
      has: () => false,
    },
    text: () => Promise.resolve(body),
  };
}

function makeErrorResponse(status: number, body: string, headers = {}) {
  return {
    ok: false,
    status,
    headers: {
      get: (name: string) => headers[name.toLowerCase()] ?? null,
      has: (name: string) => name.toLowerCase() in headers,
    },
    text: () => Promise.resolve(body),
  };
}

describe('post()', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('basic functionality', () => {
    it('sends a POST request and returns the data field', async () => {
      const responseData = { id: 1, name: 'test' };
      vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse(responseData));

      const result = await post('https://example.com/api', { foo: 'bar' });

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ foo: 'bar' }),
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
          }),
        }),
      );
      expect(result).toEqual(responseData);
    });

    it('passes custom headers to fetch', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse({}));

      await post(
        'https://example.com/api',
        {},
        { 'X-ACTUAL-TOKEN': 'my-token' },
      );

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          headers: expect.objectContaining({
            'X-ACTUAL-TOKEN': 'my-token',
          }),
        }),
      );
    });

    it('passes null as signal when no timeout and no externalSignal', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse({}));

      await post('https://example.com/api', {});

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({ signal: null }),
      );
    });

    it('throws PostError for non-200 responses', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(
        makeErrorResponse(500, 'Internal Server Error'),
      );

      await expect(post('https://example.com/api', {})).rejects.toMatchObject({
        type: 'PostError',
        reason: 'internal',
      });
    });

    it('throws PostError for network failures', async () => {
      vi.mocked(fetch).mockRejectedValueOnce(new Error('Network error'));

      await expect(post('https://example.com/api', {})).rejects.toMatchObject({
        type: 'PostError',
        reason: 'network-failure',
      });
    });
  });

  describe('timeout support', () => {
    it('passes an AbortSignal to fetch when timeout is set', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse({}));

      await post('https://example.com/api', {}, {}, 5000);

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('throws PostError network-failure on timeout (not aborted signal)', async () => {
      const abortError = new DOMException('Aborted', 'AbortError');
      vi.mocked(fetch).mockRejectedValueOnce(abortError);

      // externalSignal is not aborted, so it's treated as network-failure
      await expect(
        post('https://example.com/api', {}, {}, 100),
      ).rejects.toMatchObject({
        type: 'PostError',
        reason: 'network-failure',
      });
    });
  });

  describe('externalSignal support', () => {
    it('passes an AbortSignal to fetch when externalSignal is provided', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse({}));
      const controller = new AbortController();

      await post('https://example.com/api', {}, {}, null, controller.signal);

      expect(fetch).toHaveBeenCalledWith(
        'https://example.com/api',
        expect.objectContaining({
          signal: expect.any(AbortSignal),
        }),
      );
    });

    it('throws PostError with reason "aborted" when externalSignal is aborted', async () => {
      const controller = new AbortController();

      // Simulate fetch failing with AbortError because the external signal fired
      vi.mocked(fetch).mockImplementationOnce((_url, options) => {
        // Abort the external controller to simulate it being aborted externally
        controller.abort();
        const abortError = new DOMException('Aborted', 'AbortError');
        return Promise.reject(abortError);
      });

      await expect(
        post('https://example.com/api', {}, {}, null, controller.signal),
      ).rejects.toMatchObject({
        type: 'PostError',
        reason: 'aborted',
      });
    });

    it('throws PostError with reason "aborted" when signal is already aborted before calling post', async () => {
      const controller = new AbortController();
      controller.abort(); // Pre-abort the signal

      // With an already-aborted signal, the controller.abort() is called immediately
      // fetch will see an already-aborted signal and reject
      const abortError = new DOMException('Aborted', 'AbortError');
      vi.mocked(fetch).mockRejectedValueOnce(abortError);

      await expect(
        post('https://example.com/api', {}, {}, null, controller.signal),
      ).rejects.toMatchObject({
        type: 'PostError',
        reason: 'aborted',
      });
    });

    it('removes the event listener from externalSignal after request completes', async () => {
      const controller = new AbortController();
      const removeEventListenerSpy = vi.spyOn(
        controller.signal,
        'removeEventListener',
      );
      vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse({}));

      await post('https://example.com/api', {}, {}, null, controller.signal);

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'abort',
        expect.any(Function),
      );
    });

    it('distinguishes between timeout abort and external signal abort', async () => {
      const externalController = new AbortController();
      // DO NOT abort the externalController - simulate a timeout instead
      const abortError = new DOMException('Aborted', 'AbortError');
      vi.mocked(fetch).mockRejectedValueOnce(abortError);

      // externalSignal is NOT aborted, so the error should be 'network-failure'
      await expect(
        post(
          'https://example.com/api',
          {},
          {},
          100,
          externalController.signal,
        ),
      ).rejects.toMatchObject({
        type: 'PostError',
        reason: 'network-failure',
      });
    });

    it('still works without externalSignal (backward compatible)', async () => {
      vi.mocked(fetch).mockResolvedValueOnce(makeOkResponse({ ok: true }));

      const result = await post('https://example.com/api', {});
      expect(result).toEqual({ ok: true });
    });
  });
});
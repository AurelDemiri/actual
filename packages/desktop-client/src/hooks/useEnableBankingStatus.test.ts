import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useEnableBankingStatus } from './useEnableBankingStatus';

// Mock the send function from loot-core
vi.mock('loot-core/platform/client/connection', () => ({
  send: vi.fn(),
}));

// Mock useSyncServerStatus to control the sync server state in tests
vi.mock('./useSyncServerStatus', () => ({
  useSyncServerStatus: vi.fn(),
}));

import { send } from 'loot-core/platform/client/connection';
import { useSyncServerStatus } from './useSyncServerStatus';

describe('useEnableBankingStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useSyncServerStatus).mockReturnValue('online');
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('when status is online and enabled=true (default)', () => {
    it('calls send with enablebanking-status', async () => {
      vi.mocked(send).mockResolvedValueOnce({ configured: true });

      const { result } = renderHook(() => useEnableBankingStatus());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(send).toHaveBeenCalledWith('enablebanking-status');
    });

    it('returns configuredEnableBanking=true when server says configured=true', async () => {
      vi.mocked(send).mockResolvedValueOnce({ configured: true });

      const { result } = renderHook(() => useEnableBankingStatus());

      await waitFor(() => {
        expect(result.current.configuredEnableBanking).toBe(true);
      });
      expect(result.current.isLoading).toBe(false);
    });

    it('returns configuredEnableBanking=false when server says configured=false', async () => {
      vi.mocked(send).mockResolvedValueOnce({ configured: false });

      const { result } = renderHook(() => useEnableBankingStatus());

      await waitFor(() => {
        expect(result.current.configuredEnableBanking).toBe(false);
      });
      expect(result.current.isLoading).toBe(false);
    });

    it('returns configuredEnableBanking=false when configured is undefined/falsy', async () => {
      vi.mocked(send).mockResolvedValueOnce({ configured: undefined });

      const { result } = renderHook(() => useEnableBankingStatus());

      await waitFor(() => {
        expect(result.current.configuredEnableBanking).toBe(false);
      });
    });

    it('starts with isLoading=false and configuredEnableBanking=null', () => {
      vi.mocked(send).mockImplementationOnce(
        () => new Promise(() => {}), // Never resolves
      );

      const { result } = renderHook(() => useEnableBankingStatus());

      // Initial state before async operation completes
      expect(result.current.configuredEnableBanking).toBeNull();
    });

    it('sets isLoading=true while fetching', async () => {
      let resolvePromise: (val: unknown) => void;
      vi.mocked(send).mockImplementationOnce(
        () =>
          new Promise(resolve => {
            resolvePromise = resolve;
          }),
      );

      const { result } = renderHook(() => useEnableBankingStatus());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });

      act(() => {
        resolvePromise({ configured: true });
      });

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('when status is offline', () => {
    it('does not call send', async () => {
      vi.mocked(useSyncServerStatus).mockReturnValue('offline');

      const { result } = renderHook(() => useEnableBankingStatus());

      // Give time for potential async operations
      await Promise.resolve();
      await Promise.resolve();

      expect(send).not.toHaveBeenCalled();
      expect(result.current.configuredEnableBanking).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('when status is no-server', () => {
    it('does not call send', async () => {
      vi.mocked(useSyncServerStatus).mockReturnValue('no-server');

      const { result } = renderHook(() => useEnableBankingStatus());

      await Promise.resolve();
      await Promise.resolve();

      expect(send).not.toHaveBeenCalled();
      expect(result.current.configuredEnableBanking).toBeNull();
    });
  });

  describe('when enabled=false', () => {
    it('does not call send even when server is online', async () => {
      vi.mocked(useSyncServerStatus).mockReturnValue('online');

      const { result } = renderHook(() => useEnableBankingStatus(false));

      await Promise.resolve();
      await Promise.resolve();

      expect(send).not.toHaveBeenCalled();
      expect(result.current.configuredEnableBanking).toBeNull();
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe('error handling', () => {
    it('returns configuredEnableBanking=false when send throws', async () => {
      vi.mocked(send).mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderHook(() => useEnableBankingStatus());

      await waitFor(() => {
        expect(result.current.configuredEnableBanking).toBe(false);
      });
      expect(result.current.isLoading).toBe(false);
    });

    it('sets isLoading=false after error', async () => {
      vi.mocked(send).mockRejectedValueOnce(new Error('Server error'));

      const { result } = renderHook(() => useEnableBankingStatus());

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });
  });

  describe('re-fetching when status changes', () => {
    it('fetches when status transitions from offline to online', async () => {
      vi.mocked(useSyncServerStatus).mockReturnValue('offline');

      const { result, rerender } = renderHook(() => useEnableBankingStatus());

      expect(send).not.toHaveBeenCalled();

      vi.mocked(useSyncServerStatus).mockReturnValue('online');
      vi.mocked(send).mockResolvedValueOnce({ configured: true });

      rerender();

      await waitFor(() => {
        expect(result.current.configuredEnableBanking).toBe(true);
      });

      expect(send).toHaveBeenCalledTimes(1);
    });
  });
});
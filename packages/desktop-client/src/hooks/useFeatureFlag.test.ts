import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useFeatureFlag } from './useFeatureFlag';

vi.mock('./useSyncedPref', () => ({
  useSyncedPref: vi.fn(),
}));

import { useSyncedPref } from './useSyncedPref';

describe('useFeatureFlag', () => {
  describe('enableBanking flag', () => {
    it('defaults to false when pref is undefined', () => {
      vi.mocked(useSyncedPref).mockReturnValue([undefined, vi.fn()]);

      const { result } = renderHook(() => useFeatureFlag('enableBanking'));

      expect(result.current).toBe(false);
    });

    it('returns true when pref is set to "true"', () => {
      vi.mocked(useSyncedPref).mockReturnValue(['true', vi.fn()]);

      const { result } = renderHook(() => useFeatureFlag('enableBanking'));

      expect(result.current).toBe(true);
    });

    it('returns false when pref is set to "false"', () => {
      vi.mocked(useSyncedPref).mockReturnValue(['false', vi.fn()]);

      const { result } = renderHook(() => useFeatureFlag('enableBanking'));

      expect(result.current).toBe(false);
    });

    it('calls useSyncedPref with the correct key', () => {
      vi.mocked(useSyncedPref).mockReturnValue([undefined, vi.fn()]);

      renderHook(() => useFeatureFlag('enableBanking'));

      expect(useSyncedPref).toHaveBeenCalledWith('flags.enableBanking');
    });
  });

  describe('default flag values', () => {
    it('all feature flags default to false when pref is undefined', () => {
      vi.mocked(useSyncedPref).mockReturnValue([undefined, vi.fn()]);

      const flags = [
        'goalTemplatesEnabled',
        'goalTemplatesUIEnabled',
        'actionTemplating',
        'formulaMode',
        'currency',
        'crossoverReport',
        'customThemes',
        'budgetAnalysisReport',
        'payeeLocations',
        'enableBanking',
      ] as const;

      for (const flag of flags) {
        const { result } = renderHook(() => useFeatureFlag(flag));
        expect(result.current).toBe(false);
      }
    });
  });

  describe('pref value handling', () => {
    it('returns false when pref value is a non-"true" string', () => {
      vi.mocked(useSyncedPref).mockReturnValue(['yes', vi.fn()]);

      const { result } = renderHook(() => useFeatureFlag('enableBanking'));

      expect(result.current).toBe(false);
    });

    it('returns false when pref value is "1"', () => {
      vi.mocked(useSyncedPref).mockReturnValue(['1', vi.fn()]);

      const { result } = renderHook(() => useFeatureFlag('enableBanking'));

      expect(result.current).toBe(false);
    });

    it('returns true only for the exact string "true"', () => {
      vi.mocked(useSyncedPref).mockReturnValue(['true', vi.fn()]);

      const { result } = renderHook(() => useFeatureFlag('enableBanking'));

      expect(result.current).toBe(true);
    });
  });
});
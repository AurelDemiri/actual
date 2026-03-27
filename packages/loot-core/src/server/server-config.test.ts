import { describe, expect, it } from 'vitest';

import { getServer, isValidBaseURL, setServer } from './server-config';

describe('server-config', () => {
  describe('getServer', () => {
    describe('when called with a URL', () => {
      it('returns ENABLEBANKING_SERVER derived from the URL', () => {
        const config = getServer('https://example.com');
        expect(config?.ENABLEBANKING_SERVER).toBe(
          'https://example.com/enablebanking',
        );
      });

      it('returns all expected server config keys', () => {
        const config = getServer('https://example.com');
        expect(config).not.toBeNull();
        expect(config).toHaveProperty('BASE_SERVER', 'https://example.com');
        expect(config).toHaveProperty(
          'SYNC_SERVER',
          'https://example.com/sync',
        );
        expect(config).toHaveProperty(
          'SIGNUP_SERVER',
          'https://example.com/account',
        );
        expect(config).toHaveProperty(
          'GOCARDLESS_SERVER',
          'https://example.com/gocardless',
        );
        expect(config).toHaveProperty(
          'SIMPLEFIN_SERVER',
          'https://example.com/simplefin',
        );
        expect(config).toHaveProperty(
          'PLUGGYAI_SERVER',
          'https://example.com/pluggyai',
        );
        expect(config).toHaveProperty(
          'ENABLEBANKING_SERVER',
          'https://example.com/enablebanking',
        );
      });

      it('handles URLs with a trailing slash', () => {
        const config = getServer('https://example.com/');
        expect(config?.ENABLEBANKING_SERVER).toContain('/enablebanking');
      });

      it('handles URLs with a path prefix', () => {
        const config = getServer('https://example.com/api');
        expect(config?.ENABLEBANKING_SERVER).toContain('/enablebanking');
      });
    });

    describe('when called without a URL', () => {
      it('returns null when no global server is set', () => {
        setServer(null);
        expect(getServer()).toBeNull();
      });

      it('returns the globally configured server', () => {
        setServer('https://global.example.com');
        const config = getServer();
        expect(config?.ENABLEBANKING_SERVER).toBe(
          'https://global.example.com/enablebanking',
        );
        // Reset after test
        setServer(null);
      });
    });

    describe('when called with an invalid URL', () => {
      it('returns the global config (falls back gracefully)', () => {
        setServer('https://fallback.example.com');
        const config = getServer('not-a-valid-url');
        // Falls back to the global config
        expect(config?.BASE_SERVER).toBe('https://fallback.example.com');
        setServer(null);
      });
    });
  });

  describe('isValidBaseURL', () => {
    it('returns true for a valid https URL', () => {
      expect(isValidBaseURL('https://example.com')).toBe(true);
    });

    it('returns true for a valid http URL', () => {
      expect(isValidBaseURL('http://localhost:5006')).toBe(true);
    });

    it('returns false for an empty string', () => {
      expect(isValidBaseURL('')).toBe(false);
    });

    it('returns false for a non-URL string', () => {
      expect(isValidBaseURL('not-a-url')).toBe(false);
    });
  });

  describe('setServer', () => {
    it('updates the global config to include ENABLEBANKING_SERVER', () => {
      setServer('https://newserver.example.com');
      expect(getServer()?.ENABLEBANKING_SERVER).toBe(
        'https://newserver.example.com/enablebanking',
      );
      setServer(null);
    });

    it('sets config to null when called with null', () => {
      setServer('https://example.com');
      setServer(null);
      expect(getServer()).toBeNull();
    });
  });
});
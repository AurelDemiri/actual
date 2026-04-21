import { describe, expect, it } from 'vitest';

import { stripSepaTokens } from '#app-enablebanking/utils/strip-sepa-tokens';

describe('stripSepaTokens', () => {
  it('removes a leading EREF+ prefix', () => {
    expect(stripSepaTokens('EREF+INV-12345')).toBe('INV-12345');
  });

  it('removes multiple embedded tokens', () => {
    expect(
      stripSepaTokens('EREF+INV-1 SVWZ+Payment for services KREF+ABC'),
    ).toBe('INV-1 Payment for services ABC');
  });

  it('handles ULTD/ULTC ultimate-party tokens', () => {
    expect(stripSepaTokens('ULTD+Alice Smith ULTC+Bob Jones')).toBe(
      'Alice Smith Bob Jones',
    );
  });

  it('collapses whitespace left behind by stripped tokens', () => {
    expect(stripSepaTokens('SVWZ+   Invoice   42')).toBe('Invoice 42');
  });

  it('returns the input unchanged when no token is present', () => {
    expect(stripSepaTokens('Coffee at Cafe Nero')).toBe('Coffee at Cafe Nero');
  });

  it('returns an empty string for token-only input', () => {
    expect(stripSepaTokens('EREF+')).toBe('');
  });

  it('returns an empty string for empty input', () => {
    expect(stripSepaTokens('')).toBe('');
  });

  it('covers all documented SEPA tokens', () => {
    const raw =
      'EREF+a KREF+b MREF+c CRED+d DEBT+e ULTC+f ULTD+g SVWZ+h ABWA+i ABWE+j BOOK+k BREF+l COAM+m IBAN+n OAMT+o OCMT+p PURP+q RTRN+r';
    expect(stripSepaTokens(raw)).toBe('a b c d e f g h i j k l m n o p q r');
  });
});

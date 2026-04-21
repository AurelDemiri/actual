// ISO 20022 / CAMT.053 structured remittance-info prefixes.
const SEPA_TOKENS = [
  'EREF',
  'KREF',
  'MREF',
  'CRED',
  'DEBT',
  'ULTC',
  'ULTD',
  'SVWZ',
  'ABWA',
  'ABWE',
  'BOOK',
  'BREF',
  'COAM',
  'IBAN',
  'OAMT',
  'OCMT',
  'PURP',
  'RTRN',
];

const SEPA_TOKEN_PATTERN = new RegExp(
  `\\b(?:${SEPA_TOKENS.join('|')})\\+`,
  'g',
);

export function stripSepaTokens(input: string): string {
  return input.replace(SEPA_TOKEN_PATTERN, ' ').replace(/\s+/g, ' ').trim();
}

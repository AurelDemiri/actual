import createDebug from 'debug';

import { SecretName, secretsService } from '../../services/secrets-service';
import { EnableBankingError, handleEnableBankingError } from '../utils/errors';
import { getJWT } from '../utils/jwt';

const debug = createDebug('actual:enable-banking:service');

const BASE_URL = 'https://api.enablebanking.com';

// --- Type definitions ---

type EnableBankingTransaction = {
  entry_reference?: string;
  transaction_id?: string;
  transaction_amount: { currency: string; amount: string };
  creditor?: { name?: string };
  debtor?: { name?: string };
  credit_debit_indicator?: 'CRDT' | 'DBIT';
  status?: 'BOOK' | 'PDNG';
  booking_date?: string;
  value_date?: string;
  transaction_date?: string;
  remittance_information?: string[];
};

type EnableBankingBalance = {
  balance_amount: { currency: string; amount: string };
  balance_type: string;
  reference_date?: string;
};

type EnableBankingSessionAccount = {
  account_id?: { iban?: string };
  account_servicer?: { bic_fi?: string; name?: string };
  name?: string;
  currency?: string;
  uid: string;
};

type EnableBankingSession = {
  session_id: string;
  accounts: EnableBankingSessionAccount[];
  aspsp?: { name?: string; country?: string };
};

type EnableBankingAspsp = {
  name: string;
  country: string;
  [key: string]: unknown;
};

type EnableBankingAuthResponse = {
  url: string;
  authorization_id: string;
};

type BankSyncTransaction = {
  transactionId: string;
  date: string;
  bookingDate: string;
  valueDate?: string;
  transactionAmount: { amount: string; currency: string };
  payeeName: string;
  remittanceInformationUnstructured?: string;
  booked: boolean;
};

type BankSyncBalance = {
  balanceAmount: { amount: number; currency: string };
  balanceType: string;
  referenceDate?: string;
};

type NormalizedAccount = {
  account_id: string;
  name: string;
  institution: string;
  currency?: string;
  iban?: string;
};

// --- Helper functions ---

function getCredentials(): { applicationId: string; secretKey: string } {
  const applicationId = secretsService.get(
    SecretName.enablebanking_applicationId,
  );
  const secretKey = secretsService.get(SecretName.enablebanking_secretKey);

  if (!applicationId || !secretKey) {
    throw new EnableBankingError(
      'INVALID_INPUT',
      'NOT_CONFIGURED',
      'Enable Banking is not configured',
    );
  }

  return { applicationId, secretKey };
}

function getAuthorizationHeader(): string {
  const { applicationId, secretKey } = getCredentials();
  const token = getJWT(applicationId, secretKey);
  return `Bearer ${token}`;
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const url = `${BASE_URL}${path}`;
  debug('%s %s', method, url);

  const headers: Record<string, string> = {
    Authorization: getAuthorizationHeader(),
    'Content-Type': 'application/json',
  };

  const options: RequestInit = { method, headers };
  if (body !== undefined) {
    options.body = JSON.stringify(body);
  }

  const response = await fetch(url, options);

  if (!response.ok) {
    let responseBody: unknown;
    try {
      responseBody = await response.json();
    } catch {
      responseBody = await response.text().catch(() => 'unknown');
    }
    throw handleEnableBankingError(response.status, responseBody);
  }

  return (await response.json()) as T;
}

// --- Normalization functions ---

export function normalizeTransaction(
  tx: EnableBankingTransaction,
): BankSyncTransaction {
  const transactionId = tx.entry_reference || tx.transaction_id || '';
  const bookingDate =
    tx.booking_date || tx.value_date || tx.transaction_date || '';
  const valueDate = tx.value_date;

  let payeeName = '';
  if (tx.credit_debit_indicator === 'CRDT' && tx.creditor?.name) {
    payeeName = tx.creditor.name;
  } else if (tx.credit_debit_indicator === 'DBIT' && tx.debtor?.name) {
    payeeName = tx.debtor.name;
  } else if (tx.creditor?.name) {
    payeeName = tx.creditor.name;
  } else if (tx.debtor?.name) {
    payeeName = tx.debtor.name;
  } else if (
    tx.remittance_information &&
    tx.remittance_information.length > 0
  ) {
    payeeName = tx.remittance_information[0];
  }

  const remittanceInformationUnstructured = tx.remittance_information
    ? tx.remittance_information.join(' ')
    : undefined;

  return {
    transactionId,
    date: bookingDate,
    bookingDate,
    valueDate,
    transactionAmount: {
      amount:
        tx.credit_debit_indicator === 'DBIT'
          ? '-' + tx.transaction_amount.amount
          : tx.transaction_amount.amount,
      currency: tx.transaction_amount.currency,
    },
    payeeName,
    remittanceInformationUnstructured,
    booked: tx.status === 'BOOK',
  };
}

export function normalizeBalance(bal: EnableBankingBalance): BankSyncBalance {
  const amount = Math.round(parseFloat(bal.balance_amount.amount) * 100);
  return {
    balanceAmount: {
      amount,
      currency: bal.balance_amount.currency,
    },
    balanceType: bal.balance_type,
    referenceDate: bal.reference_date,
  };
}

export function normalizeAccount(
  account: EnableBankingSessionAccount,
  aspsp?: { name?: string },
): NormalizedAccount {
  return {
    account_id: account.uid,
    name: account.name || account.account_id?.iban || account.uid,
    institution: aspsp?.name || account.account_servicer?.name || 'Unknown',
    currency: account.currency,
    iban: account.account_id?.iban,
  };
}

// --- Service ---

export const enableBankingService = {
  isConfigured(): boolean {
    const applicationId = secretsService.get(
      SecretName.enablebanking_applicationId,
    );
    const secretKey = secretsService.get(SecretName.enablebanking_secretKey);
    return !!(applicationId && secretKey);
  },

  async getApplication(): Promise<unknown> {
    return request<unknown>('GET', '/application');
  },

  async getAspsps(country?: string): Promise<EnableBankingAspsp[]> {
    const query = country ? `?country=${encodeURIComponent(country)}` : '';
    return request<EnableBankingAspsp[]>('GET', `/aspsps${query}`);
  },

  async startAuth(
    aspsp: { name: string; country: string },
    redirectUrl: string,
    state: string,
  ): Promise<EnableBankingAuthResponse> {
    const validUntil = new Date();
    validUntil.setDate(validUntil.getDate() + 90);

    return request<EnableBankingAuthResponse>('POST', '/auth', {
      aspsp: { name: aspsp.name, country: aspsp.country },
      redirect_url: redirectUrl,
      state,
      access: {
        valid_until: validUntil.toISOString(),
      },
    });
  },

  async createSession(code: string): Promise<EnableBankingSession> {
    return request<EnableBankingSession>('POST', '/sessions', { code });
  },

  async getSession(sessionId: string): Promise<EnableBankingSession> {
    return request<EnableBankingSession>(
      'GET',
      `/sessions/${encodeURIComponent(sessionId)}`,
    );
  },

  async getBalances(
    accountUid: string,
  ): Promise<{ balances: EnableBankingBalance[] }> {
    return request<{ balances: EnableBankingBalance[] }>(
      'GET',
      `/accounts/${encodeURIComponent(accountUid)}/balances`,
    );
  },

  async getTransactions(
    accountUid: string,
    dateFrom: string,
    dateTo: string,
    continuationKey?: string,
  ): Promise<{
    transactions: EnableBankingTransaction[];
    continuation_key?: string;
  }> {
    let path = `/accounts/${encodeURIComponent(accountUid)}/transactions?date_from=${encodeURIComponent(dateFrom)}&date_to=${encodeURIComponent(dateTo)}`;
    if (continuationKey) {
      path += `&continuation_key=${encodeURIComponent(continuationKey)}`;
    }
    return request<{
      transactions: EnableBankingTransaction[];
      continuation_key?: string;
    }>('GET', path);
  },

  async getAllTransactions(
    accountUid: string,
    dateFrom: string,
    dateTo: string,
  ): Promise<EnableBankingTransaction[]> {
    const allTransactions: EnableBankingTransaction[] = [];
    let continuationKey: string | undefined;

    do {
      const result = await enableBankingService.getTransactions(
        accountUid,
        dateFrom,
        dateTo,
        continuationKey,
      );
      allTransactions.push(...result.transactions);
      continuationKey = result.continuation_key;
    } while (continuationKey);

    return allTransactions;
  },
};

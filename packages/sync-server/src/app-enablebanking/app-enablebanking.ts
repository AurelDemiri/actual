import createDebug from 'debug';
import type { Request, Response } from 'express';
import express from 'express';
import { v4 as uuidv4 } from 'uuid';

import { handleError } from '../app-gocardless/util/handle-error';
import { SecretName, secretsService } from '../services/secrets-service';
import {
  requestLoggerMiddleware,
  validateSessionMiddleware,
} from '../util/middlewares';

import {
  enableBankingService,
  normalizeAccount,
  normalizeBalance,
  normalizeTransaction,
} from './services/enablebanking-service';

const debug = createDebug('actual:enable-banking:app');

const app = express();
export { app as handlers };
app.use(requestLoggerMiddleware);
app.use(express.json());

// Auth callback from bank redirect — must be before validateSessionMiddleware
// since the bank redirects here directly (no auth token available)
app.get(
  '/auth_callback',
  async (req: Request, res: Response) => {
    const code = req.query.code as string | undefined;
    const state = req.query.state as string | undefined;

    if (!code) {
      res.status(400).send(
        '<html><body><p>Authorization failed: missing code.</p></body></html>',
      );
      return;
    }

    try {
      const session = await enableBankingService.createSession(code);
      debug(
        'Callback session created: %s with %d accounts',
        session.session_id,
        session.accounts.length,
      );

      const accountsWithBalances = await Promise.all(
        session.accounts.map(async account => {
          const normalized = normalizeAccount(account, session.aspsp);

          let balances: ReturnType<typeof normalizeBalance>[] = [];
          try {
            const balanceResult = await enableBankingService.getBalances(
              account.uid,
            );
            balances = balanceResult.balances.map(normalizeBalance);
          } catch (err) {
            debug(
              'Failed to fetch balances for account %s: %s',
              account.uid,
              err,
            );
          }

          const preferredBalance =
            balances.find(b => b.balanceType === 'CLAV') ?? balances[0];

          return {
            ...normalized,
            balance: preferredBalance
              ? preferredBalance.balanceAmount.amount
              : 0,
            balances,
          };
        }),
      );

      const result = {
        session_id: session.session_id,
        accounts: accountsWithBalances,
        aspsp: session.aspsp,
      };

      if (state && pendingAuths.has(state)) {
        const pending = pendingAuths.get(state)!;
        pending.resolve(result);
        cleanupPendingAuth(state);
      } else if (state) {
        completedAuths.set(state, result);
        setTimeout(() => completedAuths.delete(state), COMPLETED_AUTH_TTL_MS);
      }

      res.send(
        '<html><body><p>Authorization successful. This window will close.</p>' +
          '<script>setTimeout(function(){window.close()},1000)</script></body></html>',
      );
    } catch (error) {
      if (state && pendingAuths.has(state)) {
        const pending = pendingAuths.get(state)!;
        pending.reject(error);
        cleanupPendingAuth(state);
      }

      debug('Callback auth error: %s', error);
      res.status(500).send(
        '<html><body><p>Authorization failed. You can close this window and try again.</p></body></html>',
      );
    }
  },
);

app.use(validateSessionMiddleware);

// --- Poll/complete-auth coordination ---

type PendingAuth = {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
  timer: ReturnType<typeof setTimeout>;
};

const pendingAuths = new Map<string, PendingAuth>();
const completedAuths = new Map<string, unknown>();

const POLL_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const COMPLETED_AUTH_TTL_MS = 30 * 1000; // 30 seconds

function cleanupPendingAuth(state: string) {
  const entry = pendingAuths.get(state);
  if (entry) {
    clearTimeout(entry.timer);
    pendingAuths.delete(state);
  }
}

// --- Routes ---

app.post(
  '/status',
  handleError(async (req: Request, res: Response) => {
    const configured = enableBankingService.isConfigured();

    res.send({
      status: 'ok',
      data: {
        configured,
      },
    });
  }),
);

app.post(
  '/configure',
  handleError(async (req: Request, res: Response) => {
    const { applicationId, secretKey } = req.body || {};

    if (!applicationId || !secretKey) {
      res.send({
        status: 'ok',
        data: {
          error_code: 'INVALID_INPUT',
          error_type: 'Missing applicationId or secretKey',
        },
      });
      return;
    }

    // Store the credentials
    secretsService.set(SecretName.enablebanking_applicationId, applicationId);
    secretsService.set(SecretName.enablebanking_secretKey, secretKey);

    // Validate by calling getApplication
    try {
      const appInfo = await enableBankingService.getApplication();
      debug('Enable Banking application validated: %o', appInfo);

      res.send({
        status: 'ok',
        data: {
          configured: true,
        },
      });
    } catch (error) {
      // Roll back stored credentials on failure
      debug('Enable Banking configuration validation failed: %s', error);
      res.send({
        status: 'ok',
        data: {
          error_code: 'CONFIGURATION_FAILED',
          error_type: error instanceof Error ? error.message : 'unknown error',
        },
      });
    }
  }),
);

app.post(
  '/aspsps',
  handleError(async (req: Request, res: Response) => {
    const { country } = req.body || {};

    try {
      const aspsps = await enableBankingService.getAspsps(country);

      res.send({
        status: 'ok',
        data: aspsps,
      });
    } catch (error) {
      res.send({
        status: 'ok',
        data: {
          error: error instanceof Error ? error.message : 'unknown error',
        },
      });
    }
  }),
);

app.post(
  '/start-auth',
  handleError(async (req: Request, res: Response) => {
    const { aspsp, redirectUrl } = req.body || {};

    if (!aspsp || !redirectUrl) {
      res.send({
        status: 'ok',
        data: {
          error_code: 'INVALID_INPUT',
          error_type: 'Missing aspsp or redirectUrl',
        },
      });
      return;
    }

    const state = uuidv4();

    try {
      const authResponse = await enableBankingService.startAuth(
        aspsp,
        redirectUrl,
        state,
      );

      res.send({
        status: 'ok',
        data: {
          url: authResponse.url,
          state,
        },
      });
    } catch (error) {
      res.send({
        status: 'ok',
        data: {
          error: error instanceof Error ? error.message : 'unknown error',
        },
      });
    }
  }),
);

app.post(
  '/complete-auth',
  handleError(async (req: Request, res: Response) => {
    const { code, state } = req.body || {};

    if (!code) {
      res.send({
        status: 'ok',
        data: {
          error_code: 'INVALID_INPUT',
          error_type: 'Missing code',
        },
      });
      return;
    }

    try {
      const session = await enableBankingService.createSession(code);
      debug(
        'Session created: %s with %d accounts',
        session.session_id,
        session.accounts.length,
      );

      // Normalize accounts and fetch balances
      const accountsWithBalances = await Promise.all(
        session.accounts.map(async account => {
          const normalized = normalizeAccount(account, session.aspsp);

          let balances: ReturnType<typeof normalizeBalance>[] = [];
          try {
            const balanceResult = await enableBankingService.getBalances(
              account.uid,
            );
            balances = balanceResult.balances.map(normalizeBalance);
          } catch (err) {
            debug(
              'Failed to fetch balances for account %s: %s',
              account.uid,
              err,
            );
          }

          const preferredBalance =
            balances.find(b => b.balanceType === 'CLAV') ?? balances[0];

          return {
            ...normalized,
            balance: preferredBalance ? preferredBalance.balanceAmount.amount : 0,
            balances,
          };
        }),
      );

      const result = {
        session_id: session.session_id,
        accounts: accountsWithBalances,
        aspsp: session.aspsp,
      };

      // Resolve any pending poll-auth promise, or store for later pickup
      if (state && pendingAuths.has(state)) {
        const pending = pendingAuths.get(state)!;
        pending.resolve(result);
        cleanupPendingAuth(state);
      } else if (state) {
        completedAuths.set(state, result);
        setTimeout(() => completedAuths.delete(state), COMPLETED_AUTH_TTL_MS);
      }

      res.send({
        status: 'ok',
        data: result,
      });
    } catch (error) {
      // Reject any pending poll-auth promise
      if (state && pendingAuths.has(state)) {
        const pending = pendingAuths.get(state)!;
        pending.reject(error);
        cleanupPendingAuth(state);
      }

      res.send({
        status: 'ok',
        data: {
          error: error instanceof Error ? error.message : 'unknown error',
        },
      });
    }
  }),
);

app.post(
  '/poll-auth',
  handleError(async (req: Request, res: Response) => {
    const { state } = req.body || {};

    if (!state) {
      res.send({
        status: 'ok',
        data: {
          error_code: 'INVALID_INPUT',
          error_type: 'Missing state',
        },
      });
      return;
    }

    try {
      // If complete-auth already fired before poll-auth, return immediately
      if (completedAuths.has(state)) {
        const result = completedAuths.get(state);
        completedAuths.delete(state);
        res.send({ status: 'ok', data: result });
        return;
      }

      const result = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pendingAuths.delete(state);
          reject(new Error('Polling timed out'));
        }, POLL_TIMEOUT_MS);

        pendingAuths.set(state, { resolve, reject, timer });
      });

      res.send({
        status: 'ok',
        data: result,
      });
    } catch (error) {
      cleanupPendingAuth(state);
      res.send({
        status: 'ok',
        data: {
          error: error instanceof Error ? error.message : 'unknown error',
        },
      });
    }
  }),
);

app.post(
  '/transactions',
  handleError(async (req: Request, res: Response) => {
    const { accountId, startDate } = req.body || {};

    if (!accountId || !startDate) {
      res.send({
        status: 'ok',
        data: {
          error_code: 'INVALID_INPUT',
          error_type: 'Missing accountId or startDate',
        },
      });
      return;
    }

    try {
      const dateTo = new Date().toISOString().split('T')[0];
      const dateFrom =
        typeof startDate === 'string'
          ? startDate
          : new Date(startDate).toISOString().split('T')[0];

      // Fetch balances
      const balanceResult = await enableBankingService.getBalances(accountId);
      const balances = balanceResult.balances.map(normalizeBalance);

      // Determine starting balance from the first available balance
      let startingBalance = 0;
      if (balances.length > 0) {
        startingBalance = balances[0].balanceAmount.amount;
      }

      // Fetch all paginated transactions
      const rawTransactions = await enableBankingService.getAllTransactions(
        accountId,
        dateFrom,
        dateTo,
      );

      const all: ReturnType<typeof normalizeTransaction>[] = [];
      const booked: ReturnType<typeof normalizeTransaction>[] = [];
      const pending: ReturnType<typeof normalizeTransaction>[] = [];

      for (const tx of rawTransactions) {
        const normalized = normalizeTransaction(tx);
        all.push(normalized);
        if (normalized.booked) {
          booked.push(normalized);
        } else {
          pending.push(normalized);
        }
      }

      res.send({
        status: 'ok',
        data: {
          transactions: {
            all,
            booked,
            pending,
          },
          balances,
          startingBalance,
        },
      });
    } catch (error) {
      debug('Error fetching transactions: %s', error);
      res.send({
        status: 'ok',
        data: {
          error: error instanceof Error ? error.message : 'unknown error',
        },
      });
    }
  }),
);

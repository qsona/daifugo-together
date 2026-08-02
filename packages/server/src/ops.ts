import { resolve } from 'node:path';

import { SqlitePersistence } from './persistence.js';
import {
  nonNegativeIntegerOption,
  optionValue,
  parseSince,
} from './operations/cli.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

function startOfJstDay(now: number): number {
  return Math.floor((now + JST_OFFSET_MS) / DAY_MS) * DAY_MS - JST_OFFSET_MS;
}

function option(name: string): string | null {
  return optionValue(process.argv, name);
}

function requiredOption(name: string): string {
  const value = option(name);
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function cardId(): number {
  const value = Number(requiredOption('--card'));
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error('--card must be a positive integer');
  }
  return value;
}

const command = process.argv[2];
const persistence = new SqlitePersistence(
  resolve(process.env.DATABASE_PATH ?? 'data/daifugo.sqlite'),
);

try {
  if (command === 'status' || command === 'budget') {
    const limit = nonNegativeIntegerOption(process.argv, '--limit', 20, 1_000);
    if (limit === 0) throw new Error('--limit must be greater than zero');
    const offset = nonNegativeIntegerOption(process.argv, '--offset', 0);
    process.stdout.write(
      `${JSON.stringify(
        persistence.operations.status(Date.now(), { limit, offset }),
      )}\n`,
    );
  } else if (command === 'funnel') {
    const now = Date.now();
    const since = parseSince(option('--since'), now);
    if (!Number.isSafeInteger(since) || since < 0 || since >= now) {
      throw new Error('--since must be an ISO date before now');
    }
    process.stdout.write(
      `${JSON.stringify(persistence.operations.funnel(since, now))}\n`,
    );
  } else if (command === 'metrics') {
    const now = Date.now();
    const since = parseSince(option('--since'), now);
    if (!Number.isSafeInteger(since) || since < 0 || since >= now) {
      throw new Error('--since must be an ISO date before now');
    }
    process.stdout.write(
      `${JSON.stringify(persistence.operations.metrics(since, now))}\n`,
    );
  } else if (command === 'activity') {
    const now = Date.now();
    const since = parseSince(option('--since'), now);
    if (!Number.isSafeInteger(since) || since < 0 || since >= now) {
      throw new Error('--since must be an ISO date before now');
    }
    process.stdout.write(
      `${JSON.stringify(persistence.operations.activity(since, now))}\n`,
    );
  } else if (command === 'dashboard') {
    const now = Date.now();
    const today = startOfJstDay(now);
    process.stdout.write(
      `${JSON.stringify({
        generatedAt: now,
        windows: {
          last30m: persistence.operations.activity(now - 30 * 60 * 1_000, now),
          last3h: persistence.operations.activity(
            now - 3 * 60 * 60 * 1_000,
            now,
          ),
          today: persistence.operations.activity(today, now),
        },
        rules: persistence.operations.metrics(today, now).rules,
        funnel: persistence.operations.funnel(today, now),
        queue: persistence.operations.status(now).queue,
      })}\n`,
    );
  } else if (command === 'settings') {
    if (process.argv[3] !== 'set') {
      throw new Error('settings requires: set KEY VALUE');
    }
    const key = process.argv[4];
    const value = process.argv[5];
    if (!key || value === undefined) {
      throw new Error('settings set requires KEY and VALUE');
    }
    persistence.evaluations.setSetting(key, value, Date.now());
    if (key.startsWith('elimination_')) {
      persistence.evaluations.evaluateAll(Date.now());
    }
    process.stdout.write(`${JSON.stringify({ key, value })}\n`);
  } else if (command === 'rule') {
    if (process.argv[3] !== 'reinstate') {
      throw new Error('rule requires: reinstate RULE_ID --reason TEXT');
    }
    const ruleId = process.argv[4];
    if (!ruleId) throw new Error('rule reinstate requires RULE_ID');
    const reinstated = persistence.evaluations.reinstate(
      ruleId,
      requiredOption('--reason'),
      Date.now(),
    );
    if (!reinstated) throw new Error(`could not reinstate ${ruleId}`);
    process.stdout.write(
      `${JSON.stringify({ ruleId, status: 'reinstated' })}\n`,
    );
  } else if (command === 'popularity') {
    if (process.argv[3] !== 'recompute') {
      throw new Error('popularity requires: recompute');
    }
    persistence.evaluations.recomputeAllPopularity(Date.now());
    process.stdout.write(`${JSON.stringify({ status: 'recomputed' })}\n`);
  } else if (command === 'list-appeals') {
    for (const appeal of persistence.injection.listOpenAppeals()) {
      process.stdout.write(`${JSON.stringify(appeal)}\n`);
    }
  } else if (command === 'revoke-card') {
    const id = cardId();
    const result = persistence.injection.revokeCard(
      id,
      requiredOption('--note'),
      Date.now(),
    );
    if (result === 'not_found') {
      throw new Error(`yellow card ${String(id)} was not found`);
    }
    process.stdout.write(`${JSON.stringify({ cardId: id, status: result })}\n`);
  } else if (command === 'reject-appeal') {
    const id = cardId();
    const rejected = persistence.injection.rejectAppeal(
      id,
      requiredOption('--note'),
      Date.now(),
    );
    if (!rejected) {
      throw new Error(
        `open appeal for yellow card ${String(id)} was not found`,
      );
    }
    process.stdout.write(
      `${JSON.stringify({ cardId: id, status: 'rejected' })}\n`,
    );
  } else {
    throw new Error(
      'command must be status, budget, funnel, metrics, activity, dashboard, settings, rule, popularity, list-appeals, revoke-card, or reject-appeal',
    );
  }
} finally {
  persistence.close();
}

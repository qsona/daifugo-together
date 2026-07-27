import { resolve } from 'node:path';

import { SqlitePersistence } from './persistence.js';

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
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
  if (command === 'list-appeals') {
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
      'command must be list-appeals, revoke-card, or reject-appeal',
    );
  }
} finally {
  persistence.close();
}

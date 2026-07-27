import { readFile } from 'node:fs/promises';

import {
  confirmationRequest,
  parseConfirmationCommand,
} from './confirmation.js';

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

const file = option('--file');
if (!file) throw new Error('--file is required');
const token = process.env.ADMIN_PIPELINE_TOKEN?.trim();
if (!token) throw new Error('ADMIN_PIPELINE_TOKEN is required');
const baseUrl = new URL(
  option('--base-url') ??
    process.env.DAIFUGO_ADMIN_URL ??
    'http://127.0.0.1:3000',
);

let input: unknown;
try {
  input = JSON.parse(await readFile(file, 'utf8'));
} catch (error) {
  throw new Error(
    `could not read confirmation JSON: ${
      error instanceof Error ? error.message : String(error)
    }`,
    { cause: error },
  );
}
const command = parseConfirmationCommand(input);
if (!command) throw new Error('confirmation JSON is invalid');
const request = confirmationRequest(command);
const response = await fetch(new URL(request.path, baseUrl), {
  method: 'POST',
  headers: {
    authorization: `Bearer ${token}`,
    'content-type': 'application/json',
  },
  body: JSON.stringify(request.body),
});
const text = await response.text();
let result: unknown;
try {
  result = JSON.parse(text);
} catch {
  throw new Error(`admin API returned non-JSON (${String(response.status)})`);
}
if (!response.ok) {
  throw new Error(
    `admin API ${String(response.status)}: ${JSON.stringify(result)}`,
  );
}
process.stdout.write(`${JSON.stringify(result)}\n`);

import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir, userInfo } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';

import type { PendingVerdictConfirmation } from '@daifugo/server';

import {
  confirmationRequest,
  parseConfirmationCommand,
  type ConfirmationCommand,
} from './confirmation.js';
import {
  editableConfirmation,
  extensionPendingSummary,
  formatReviewItem,
  manualRejectionConfirmation,
  MANUAL_REJECTION_REASONS,
  suggestedConfirmation,
  validateConfirmationForItem,
} from './review.js';

const DESIGN_HANDOFF_HINT =
  'pnpm --filter @daifugo/pipeline design:handoff -- ';

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

function positiveIntegerOption(name: string, fallback: number): number {
  const raw = option(name);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

function reviewActor(): string {
  const explicit = option('--actor') ?? process.env.PIPELINE_ACTOR?.trim();
  if (explicit) return explicit;
  const gitEmail = spawnSync('git', ['config', 'user.email'], {
    encoding: 'utf8',
  });
  const email =
    gitEmail.status === 0 && typeof gitEmail.stdout === 'string'
      ? gitEmail.stdout.trim()
      : '';
  return email || `local:${userInfo().username}`;
}

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`admin API returned non-JSON (${String(response.status)})`);
  }
}

async function requestJson(
  url: URL,
  token: string,
  init: RequestInit = {},
): Promise<unknown> {
  const response = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      ...(init.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
    },
  });
  const body = await readJson(response);
  if (!response.ok) {
    throw new Error(
      `admin API ${String(response.status)}: ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function confirmations(value: unknown): PendingVerdictConfirmation[] {
  if (
    typeof value !== 'object' ||
    value === null ||
    !('items' in value) ||
    !Array.isArray(value.items)
  ) {
    throw new Error('admin API returned an invalid screening list');
  }
  return (value.items as Array<{ stage?: unknown }>)
    .filter(({ stage }) => stage === 'confirmation')
    .map((item) => item as unknown as PendingVerdictConfirmation);
}

async function editConfirmation(
  item: PendingVerdictConfirmation,
  actor: string,
): Promise<ConfirmationCommand> {
  const directory = await mkdtemp(join(tmpdir(), 'daifugo-review-'));
  const file = join(directory, 'confirmation.json');
  try {
    await writeFile(
      file,
      `${JSON.stringify(editableConfirmation(item, actor), null, 2)}\n`,
      { encoding: 'utf8', mode: 0o600 },
    );
    const editor =
      process.env.VISUAL?.trim() || process.env.EDITOR?.trim() || 'vi';
    const edited = spawnSync(editor, [file], { stdio: 'inherit' });
    if (edited.error) throw edited.error;
    if (edited.status !== 0) {
      throw new Error(`editor exited with status ${String(edited.status)}`);
    }
    const command = parseConfirmationCommand(
      JSON.parse(await readFile(file, 'utf8')) as unknown,
    );
    if (command === null)
      throw new Error('編集したconfirmation JSONが不正です');
    const invalid = validateConfirmationForItem(item, command);
    if (invalid !== null) throw new Error(invalid);
    return command;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

async function chooseRejection(
  terminal: ReturnType<typeof createInterface>,
  item: Extract<PendingVerdictConfirmation, { source: 'cx01' }>,
  actor: string,
): Promise<ConfirmationCommand | null> {
  const choices = MANUAL_REJECTION_REASONS.map(
    ({ key, label }) => `[${key}] ${label}`,
  ).join('\n');
  while (true) {
    const answer = (
      await terminal.question(
        `却下理由を選んでください。\n${choices}\n[b] 戻る\n> `,
      )
    )
      .trim()
      .toLowerCase();
    if (answer === 'b') return null;
    const reason = MANUAL_REJECTION_REASONS.find(({ key }) => key === answer);
    if (!reason) {
      process.stdout.write('表示されたキーから選んでください。\n');
      continue;
    }
    if (reason.reasonForUser !== null) {
      return manualRejectionConfirmation(item, actor, reason);
    }
    const customReason = (
      await terminal.question('ユーザーに表示する理由を入力してください。\n> ')
    ).trim();
    const command = manualRejectionConfirmation(
      item,
      actor,
      reason,
      customReason,
    );
    if (command !== null) return command;
    process.stdout.write('理由を入力してください。\n');
  }
}

async function submit(
  baseUrl: URL,
  token: string,
  command: ConfirmationCommand,
): Promise<unknown> {
  const request = confirmationRequest(command);
  return requestJson(new URL(request.path, baseUrl), token, {
    method: 'POST',
    body: JSON.stringify(request.body),
  });
}

const token = process.env.ADMIN_PIPELINE_TOKEN?.trim();
if (!token) throw new Error('ADMIN_PIPELINE_TOKEN is required');
const actor = reviewActor();
const baseUrl = new URL(
  option('--base-url') ??
    process.env.DAIFUGO_ADMIN_URL ??
    'http://127.0.0.1:3000',
);
const limit = positiveIntegerOption('--limit', 100);
const listed = await requestJson(
  new URL('/admin/pipeline/screening', baseUrl),
  token,
);
const items = confirmations(listed).slice(0, limit);

const pendingSummary = extensionPendingSummary(items);
if (pendingSummary !== null) {
  process.stdout.write(
    `拡張待ちの提案(エンジン/契約の拡張があれば実装可能):\n${pendingSummary}\n設計セッションへの引き継ぎ: ${DESIGN_HANDOFF_HINT}<提案ID>\n\n`,
  );
}

if (items.length === 0) {
  process.stdout.write('確定待ちの提案はありません。\n');
} else {
  const terminal = createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  let confirmed = 0;
  let skipped = 0;
  let quit = false;
  try {
    for (const [offset, item] of items.entries()) {
      process.stdout.write(
        `\n${formatReviewItem(item, offset + 1, items.length)}\n\n`,
      );
      const suggested = suggestedConfirmation(item, actor);
      const acceptKey =
        suggested?.action === 'approve_spec'
          ? 'a'
          : suggested === null
            ? null
            : 'r';
      if (
        item.source === 'cx01' &&
        item.judgement.verdict === 'needs_review' &&
        item.judgement.extensionNeeded !== null
      ) {
        process.stdout.write(
          `設計セッションへの引き継ぎ: ${DESIGN_HANDOFF_HINT}${item.proposal.id}\n`,
        );
      }
      const choices = [
        ...(acceptKey === 'a' ? ['[a] 承認して次へ'] : []),
        ...(item.source === 'cx01' ? ['[r] 理由を選んで却下'] : []),
        ...(item.source === 'e6' ? ['[r] 却下を確定して次へ'] : []),
        `[e] ${suggested === null ? '判断内容を編集して確定' : '内容を編集して確定'}`,
        '[s] 保留して次へ',
        '[q] 終了',
      ].join('  ');

      while (true) {
        const answer = (await terminal.question(`${choices}\n> `))
          .trim()
          .toLowerCase();
        if (answer === 'q') {
          quit = true;
          break;
        }
        if (answer === 's') {
          skipped += 1;
          break;
        }
        let command: ConfirmationCommand;
        if (answer === 'e') {
          try {
            command = await editConfirmation(item, actor);
          } catch (error) {
            process.stderr.write(
              `編集内容を確定できません: ${error instanceof Error ? error.message : String(error)}\n`,
            );
            continue;
          }
        } else if (answer === 'r' && item.source === 'cx01') {
          const rejection = await chooseRejection(terminal, item, actor);
          if (rejection === null) continue;
          command = rejection;
        } else if (answer === acceptKey && suggested !== null) {
          command = suggested;
        } else {
          process.stdout.write('表示されたキーから選んでください。\n');
          continue;
        }
        try {
          const result = await submit(baseUrl, token, command);
          process.stdout.write(`確定しました: ${JSON.stringify(result)}\n`);
          confirmed += 1;
          break;
        } catch (error) {
          process.stderr.write(
            `確定に失敗しました: ${error instanceof Error ? error.message : String(error)}\n`,
          );
        }
      }
      if (quit) break;
    }
  } finally {
    terminal.close();
  }
  process.stdout.write(
    `\nレビュー終了: 確定 ${String(confirmed)}件 / 保留 ${String(skipped)}件 / 未処理 ${String(items.length - confirmed - skipped)}件\n`,
  );
}

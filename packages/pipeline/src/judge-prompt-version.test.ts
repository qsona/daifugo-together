// 目的: 「プロンプト本文を変えたら CX01_PROMPT_VERSION を繰り上げる」を機械的に強制する。
// judge-run.ts は現行版を promptVersion クエリに載せ、旧版の未確定AI判定を再判定対象に含める。
// 本文だけ変えて版を据え置くと、その自動再判定が起きないまま旧版の判定が残る。
// 運用規約: PROMPT_HASHES は履歴として累積する。既存エントリの書き換えは方針違反で、
// 版を繰り上げて新しい { 版: ハッシュ } の組を追記すること。
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import type { PendingCxJudgement } from '@daifugo/server';

import { buildCxJudgePrompt, CX01_PROMPT_VERSION } from './judge-prompt.js';

// 版ごとのプロンプト全文の sha256。過去版のエントリは消さずに追記していく。
const PROMPT_HASHES: Record<string, string> = {
  'cx01-v15':
    'b527437a6e0ff9f708897dabd46135ed26eb3594317db65355d12caca414c6ab',
  'cx01-v16':
    '421b10c172f3c9231ece23795d9adfe2d3ed7291527ce1bb5b15cef1649560e7',
  'cx01-v17':
    'a95f20a420ac3bed889e35ca124c70c9d9c9a2e8237513443b1e375aec47bb70',
  'cx01-v18':
    'd916175ae9b3df4c930dd2e729c9e4dac052bdc8bcdc65ccc264aba348e5bc79',
  'cx01-v19':
    'f99277d70db9b7a652a567e0907c6e3b01a409b6fc04574bd74286523d9a2ef6',
  'cx01-v20':
    '5e6b243159f7fc7cc60806e42abf6db53665132988fe3d6c5097c3d6adb062c9',
  'cx01-v21':
    '1dcca4c53d01e3c3ee855dc361446a1a5a0df0eb2722fbd55050f97bc74fcf29',
};

const TEXT = 'ダミー\nダミー本文。';

// ハッシュ入力そのものなので、この fixture は凍結する。ここを変えると本文を変えていなくても
// ハッシュがずれる。judge-prompt-vocabulary.test.ts の同種 fixture とは意図的に独立させ、
// あちらの変更が版ピンへ波及しないようにしている。
function pending(): PendingCxJudgement {
  return {
    proposal: {
      id: 'prompt-version',
      userId: 'prompt-version',
      kind: 'original',
      prefectureCode: null,
      name: 'ダミー',
      body: 'ダミー本文。',
    },
    signals: {
      proposalId: 'prompt-version',
      userId: 'prompt-version',
      detectorVersion: 'prompt-version',
      inputText: TEXT,
      normalizedText: TEXT,
      inputHash: 'prompt-version',
      layer0: { invisibleChars: false, lengthExceeded: false },
      layer1: { hard: [], soft: [] },
      layer2: {
        hasCodeFence: false,
        hasUrl: false,
        hasBase64Like: false,
        langSwitch: false,
        systemVocabDensity: false,
        trailingDirective: false,
      },
      createdAt: 0,
    },
    check: {
      id: 1,
      proposalId: 'prompt-version',
      userId: 'prompt-version',
      inputText: TEXT,
      finalVerdict: 'pass',
      llmVerdict: 'clean',
      reviewFlag: false,
      createdAt: 0,
    },
    existingRules: [],
  };
}

describe('CX-01 プロンプト版のピン', () => {
  const actualHash = createHash('sha256')
    .update(buildCxJudgePrompt(pending()), 'utf8')
    .digest('hex');

  it('現行の CX01_PROMPT_VERSION が PROMPT_HASHES に記録されている', () => {
    expect(
      Object.hasOwn(PROMPT_HASHES, CX01_PROMPT_VERSION),
      `${CX01_PROMPT_VERSION} が PROMPT_HASHES にない。版を繰り上げたら { 版: ハッシュ } を追記すること（実測 ${actualHash}）`,
    ).toBe(true);
  });

  it('プロンプト全文が記録済みハッシュと一致する', () => {
    expect(
      actualHash,
      `プロンプト本文を変更したら CX01_PROMPT_VERSION を繰り上げ、新しい版とハッシュの組を追記すること。既存エントリの書き換えは方針違反（現行版 ${CX01_PROMPT_VERSION} の実測 ${actualHash}）`,
    ).toBe(PROMPT_HASHES[CX01_PROMPT_VERSION]);
  });
});

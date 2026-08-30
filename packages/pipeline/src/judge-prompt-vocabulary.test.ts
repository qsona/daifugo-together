// エンジン語彙（Effect / hook / ルール入力 kind / ミニゲーム / engineFeatures）を拡張すると
// このテストが落ちる。落ちたら judge-prompt.ts の資料と CX01_OUTPUT_SCHEMA を新しい語彙へ
// 追従させ、CX01_PROMPT_VERSION を繰り上げること（審査プロンプトの陳腐化防止）。
// ただしこれは語彙が言及されているかのスモークチェックであり、説明の文脈が妥当かどうかや、
// 他の語の部分文字列として当たる偽陽性（特に 'player' は 'players' に一致する）までは
// 保証しない。
import { describe, expect, it } from 'vitest';

import {
  EFFECT_TYPES,
  ENGINE_FEATURES,
  MINI_GAME_IDS,
  RULE_HOOK_NAMES,
  RULE_INPUT_KINDS,
} from '@daifugo/core';
import type { PendingCxJudgement } from '@daifugo/server';

import { CX01_OUTPUT_SCHEMA } from './app-server-judge.js';
import { buildCxJudgePrompt } from './judge-prompt.js';

const TEXT = 'ダミー\nダミー本文。';

function pending(): PendingCxJudgement {
  return {
    proposal: {
      id: 'vocabulary',
      userId: 'vocabulary',
      kind: 'original',
      prefectureCode: null,
      name: 'ダミー',
      body: 'ダミー本文。',
    },
    signals: {
      proposalId: 'vocabulary',
      userId: 'vocabulary',
      detectorVersion: 'vocabulary',
      inputText: TEXT,
      normalizedText: TEXT,
      inputHash: 'vocabulary',
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
      proposalId: 'vocabulary',
      userId: 'vocabulary',
      inputText: TEXT,
      finalVerdict: 'pass',
      llmVerdict: 'clean',
      reviewFlag: false,
      createdAt: 0,
    },
    existingRules: [],
  };
}

const VOCABULARIES = {
  EFFECT_TYPES,
  RULE_HOOK_NAMES,
  RULE_INPUT_KINDS,
  MINI_GAME_IDS,
  ENGINE_FEATURES,
} satisfies Record<string, readonly string[]>;

const specSchema = CX01_OUTPUT_SCHEMA.properties.spec.anyOf[0];

describe('CX-01 プロンプトとエンジン語彙のパリティ', () => {
  const prompt = buildCxJudgePrompt(pending());

  it.each(Object.entries(VOCABULARIES))(
    '%s の全要素がプロンプトに出現する',
    (_name, vocabulary) => {
      for (const term of vocabulary) {
        expect(prompt, term).toContain(term);
      }
    },
  );

  it.each(Object.entries(VOCABULARIES))(
    '%s に重複がない',
    (_name, vocabulary) => {
      expect(new Set(vocabulary).size).toBe(vocabulary.length);
    },
  );

  it('CX01_OUTPUT_SCHEMA の hooks / effects / engineFeatures が core の語彙と一致する', () => {
    expect(new Set(specSchema.properties.hooks.items.enum)).toEqual(
      new Set(RULE_HOOK_NAMES),
    );
    expect(new Set(specSchema.properties.effects.items.enum)).toEqual(
      new Set(EFFECT_TYPES),
    );
    expect(new Set(specSchema.properties.engineFeatures.items.enum)).toEqual(
      new Set(ENGINE_FEATURES),
    );
  });

  it('ルール合成条件に使う固定ルールID一覧を説明する', () => {
    expect(prompt).toContain('context.game.ruleIds');
    expect(prompt).toContain('有効ルールID');
  });

  it('公開履歴からプレイとパスをまたぐ状態を導出できると説明する', () => {
    expect(prompt).toContain('context.game.history');
    expect(prompt).toContain('played');
    expect(prompt).toContain('passed');
    expect(prompt).toContain('onTurnAdvance');
    expect(prompt).toContain('needs_review にしない');
  });
});

import { describe, expect, it } from 'vitest';

import {
  countCodePoints,
  PREFECTURES,
  PROPOSAL_BODY_MAX_LENGTH,
  PROPOSAL_NAME_MAX_LENGTH,
  prefectureName,
  proposalDedupText,
  validateProposal,
} from './proposal.js';

describe('proposal contract', () => {
  it('47都道府県を共有し、コードから表示名を引ける', () => {
    expect(PREFECTURES).toHaveLength(47);
    expect(prefectureName('01')).toBe('北海道');
    expect(prefectureName('47')).toBe('沖縄県');
    expect(prefectureName('48')).toBeNull();
  });

  it('ローカル提案をNFC正規化し、任意の都道府県と改行を保つ', () => {
    expect(
      validateProposal({
        kind: 'local',
        prefectureCode: '11',
        name: '  カ\u3099革命  ',
        body: '  8を出したら\r\n場が流れる。  ',
      }),
    ).toEqual({
      ok: true,
      value: {
        kind: 'local',
        prefectureCode: '11',
        name: 'ガ革命',
        body: '8を出したら\n場が流れる。',
      },
    });
  });

  it('40文字を超える名前とoriginalの都道府県を拒否する', () => {
    const result = validateProposal({
      kind: 'original',
      prefectureCode: '13',
      name: 'あ'.repeat(PROPOSAL_NAME_MAX_LENGTH + 1),
      body: '自由なルール',
    });
    expect(result).toEqual({
      ok: false,
      errors: [
        { field: 'prefectureCode', code: 'not_allowed' },
        { field: 'name', code: 'too_long' },
      ],
    });
  });

  it('名前40文字・本文1000文字ちょうどを許可し、1文字超過を拒否する', () => {
    expect(
      validateProposal({
        kind: 'original',
        name: '名'.repeat(PROPOSAL_NAME_MAX_LENGTH),
        body: '文'.repeat(PROPOSAL_BODY_MAX_LENGTH),
      }).ok,
    ).toBe(true);
    expect(
      validateProposal({
        kind: 'original',
        name: '名'.repeat(PROPOSAL_NAME_MAX_LENGTH + 1),
        body: '文'.repeat(PROPOSAL_BODY_MAX_LENGTH + 1),
      }),
    ).toEqual({
      ok: false,
      errors: [
        { field: 'name', code: 'too_long' },
        { field: 'body', code: 'too_long' },
      ],
    });
  });

  it('サロゲートペアを1コードポイントで数え、絵文字ZWJは保存する', () => {
    expect(countCodePoints('😀')).toBe(1);
    const result = validateProposal({
      kind: 'original',
      name: '😀'.repeat(PROPOSAL_NAME_MAX_LENGTH),
      body: '家族👨‍👩‍👧‍👦ルール',
    });
    expect(result).toMatchObject({
      ok: true,
      value: { body: '家族👨‍👩‍👧‍👦ルール' },
    });
  });

  it('C0・ゼロ幅・BiDi制御を除去し、tabを空白、改行をLFで保つ', () => {
    expect(
      validateProposal({
        kind: 'local',
        name: '8\u200B切\u202Eり',
        body: 'A\tB\u0000\r\nC\u2060',
      }),
    ).toEqual({
      ok: true,
      value: {
        kind: 'local',
        prefectureCode: null,
        name: '8切り',
        body: 'A B\nC',
      },
    });
  });

  it('除去後の空・名前の改行・空文字の都道府県を拒否する', () => {
    expect(
      validateProposal({
        kind: 'local',
        prefectureCode: '',
        name: 'a\nb',
        body: '\u200B\u2060',
      }),
    ).toEqual({
      ok: false,
      errors: [
        { field: 'prefectureCode', code: 'invalid' },
        { field: 'name', code: 'newline_not_allowed' },
        { field: 'body', code: 'required' },
      ],
    });
  });

  it('全都道府県コードを許可し、範囲外を拒否する', () => {
    for (const prefecture of PREFECTURES) {
      expect(
        validateProposal({
          kind: 'local',
          prefectureCode: prefecture.code,
          name: '地方ルール',
          body: '本文',
        }).ok,
      ).toBe(true);
    }
    for (const prefectureCode of ['00', '48', '4A']) {
      expect(
        validateProposal({
          kind: 'local',
          prefectureCode,
          name: '地方ルール',
          body: '本文',
        }),
      ).toMatchObject({
        ok: false,
        errors: [{ field: 'prefectureCode', code: 'invalid' }],
      });
    }
  });

  it('HTMLはプレーンテキストのまま保存し、重複用だけNFKC・大小・空白を畳む', () => {
    const first = validateProposal({
      kind: 'original',
      name: '＜Ｂ＞',
      body: '<script> x </script>',
    });
    const second = validateProposal({
      kind: 'original',
      name: '<b>',
      body: '<SCRIPT>\nX\t</SCRIPT>',
    });
    expect(first).toMatchObject({
      ok: true,
      value: { name: '＜Ｂ＞', body: '<script> x </script>' },
    });
    expect(first.ok && second.ok).toBe(true);
    if (first.ok && second.ok) {
      expect(proposalDedupText(first.value)).toBe(
        proposalDedupText(second.value),
      );
    }
  });
});

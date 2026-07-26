import { describe, expect, it } from 'vitest';

import {
  PREFECTURES,
  PROPOSAL_NAME_MAX_LENGTH,
  prefectureName,
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

  it('12文字を超える名前とoriginalの都道府県を拒否する', () => {
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
});

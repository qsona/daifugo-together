import { createHash } from 'node:crypto';

import {
  PROPOSAL_BODY_MAX_LENGTH,
  PROPOSAL_NAME_MAX_LENGTH,
  countCodePoints,
  type NormalizedProposal,
} from '@daifugo/core';

const INVISIBLE_OR_BIDI =
  /[\u200B\u200C\u2060\uFEFF\u202A-\u202E\u2066-\u2069]/u;

const CONFUSABLES = new Map([
  ['а', 'a'],
  ['е', 'e'],
  ['о', 'o'],
  ['р', 'p'],
  ['с', 'c'],
  ['х', 'x'],
  ['і', 'i'],
  ['ј', 'j'],
]);

export interface Layer0Flags {
  invisibleChars: boolean;
  lengthExceeded: boolean;
}

export interface NormalizedDetectionInput {
  inputText: string;
  normalizedText: string;
  inputHash: string;
  layer0: Layer0Flags;
}

export function normalizeDetectionInput(
  proposal: NormalizedProposal,
): NormalizedDetectionInput {
  const inputText = `ルール名: ${proposal.name}\nルール内容: ${proposal.body}`;
  const normalizedText = Array.from(
    inputText.normalize('NFKC').toLocaleLowerCase('ja-JP'),
    (character) => CONFUSABLES.get(character) ?? character,
  ).join('');
  return {
    inputText,
    normalizedText,
    inputHash: createHash('sha256').update(normalizedText).digest('hex'),
    layer0: {
      invisibleChars:
        INVISIBLE_OR_BIDI.test(proposal.name) ||
        INVISIBLE_OR_BIDI.test(proposal.body),
      lengthExceeded:
        countCodePoints(proposal.name) > PROPOSAL_NAME_MAX_LENGTH ||
        countCodePoints(proposal.body) > PROPOSAL_BODY_MAX_LENGTH,
    },
  };
}

export const PROPOSAL_NAME_MAX_LENGTH = 40;
export const PROPOSAL_BODY_MAX_LENGTH = 1_000;

export const PREFECTURES = [
  { code: '01', name: '北海道' },
  { code: '02', name: '青森県' },
  { code: '03', name: '岩手県' },
  { code: '04', name: '宮城県' },
  { code: '05', name: '秋田県' },
  { code: '06', name: '山形県' },
  { code: '07', name: '福島県' },
  { code: '08', name: '茨城県' },
  { code: '09', name: '栃木県' },
  { code: '10', name: '群馬県' },
  { code: '11', name: '埼玉県' },
  { code: '12', name: '千葉県' },
  { code: '13', name: '東京都' },
  { code: '14', name: '神奈川県' },
  { code: '15', name: '新潟県' },
  { code: '16', name: '富山県' },
  { code: '17', name: '石川県' },
  { code: '18', name: '福井県' },
  { code: '19', name: '山梨県' },
  { code: '20', name: '長野県' },
  { code: '21', name: '岐阜県' },
  { code: '22', name: '静岡県' },
  { code: '23', name: '愛知県' },
  { code: '24', name: '三重県' },
  { code: '25', name: '滋賀県' },
  { code: '26', name: '京都府' },
  { code: '27', name: '大阪府' },
  { code: '28', name: '兵庫県' },
  { code: '29', name: '奈良県' },
  { code: '30', name: '和歌山県' },
  { code: '31', name: '鳥取県' },
  { code: '32', name: '島根県' },
  { code: '33', name: '岡山県' },
  { code: '34', name: '広島県' },
  { code: '35', name: '山口県' },
  { code: '36', name: '徳島県' },
  { code: '37', name: '香川県' },
  { code: '38', name: '愛媛県' },
  { code: '39', name: '高知県' },
  { code: '40', name: '福岡県' },
  { code: '41', name: '佐賀県' },
  { code: '42', name: '長崎県' },
  { code: '43', name: '熊本県' },
  { code: '44', name: '大分県' },
  { code: '45', name: '宮崎県' },
  { code: '46', name: '鹿児島県' },
  { code: '47', name: '沖縄県' },
] as const;

export type PrefectureCode = (typeof PREFECTURES)[number]['code'];
export type ProposalKind = 'local' | 'original';
export type ProposalStatus =
  'screening' | 'implementing' | 'released' | 'rejected' | 'failed';

export interface CreateProposalRequest {
  kind: ProposalKind;
  prefectureCode?: string | null;
  name: string;
  body: string;
}

export interface ProposalListItem {
  id: string;
  kind: ProposalKind;
  prefectureCode: PrefectureCode | null;
  prefectureName: string | null;
  name: string;
  body: string;
  status: ProposalStatus;
  reason: { code: string; text: string } | null;
  releasedRuleId: string | null;
  popularity: number | null;
  priorityRank: number | null;
  unread: boolean;
  /** 匿名おためし枠を占有中か（進行中述語をサーバーで評価した値）。 */
  occupiesSlot: boolean;
  createdAt: number;
  statusChangedAt: number;
}

export interface MyProposalsResponse {
  items: ProposalListItem[];
  unreadCount: number;
}

export type YellowCardInfo =
  | {
      verdict: 'card';
      card: { active: 1 | 2; limit: 2 };
      suspension: { level: number; endsAt: number } | null;
    }
  | {
      verdict: 'soft';
      reasonKey: 'invisible_chars' | 'format' | 'generic';
      message: string;
    };

export type YellowCardStatus = 'active' | 'consumed' | 'expired' | 'revoked';

export type CardAppealStatus = 'open' | 'upheld' | 'rejected';

export interface YellowCardSummary {
  active: number;
  limit: 2;
  cards: Array<{
    id: number;
    issuedAt: number;
    status: YellowCardStatus;
    expiresAt: number;
    appeal: { status: CardAppealStatus } | null;
  }>;
  suspension: {
    level: number;
    startsAt: number;
    endsAt: number;
  } | null;
}

export interface CreateCardAppealResponse {
  appealId: number;
  status: 'open';
}

export type CreateProposalResponse = {
  outcome: 'accepted';
  proposal: ProposalListItem;
};

export type ProposalField = 'kind' | 'prefectureCode' | 'name' | 'body';

export interface ProposalValidationError {
  field: ProposalField;
  code:
    'required' | 'invalid' | 'too_long' | 'not_allowed' | 'newline_not_allowed';
}

export interface NormalizedProposal {
  kind: ProposalKind;
  prefectureCode: PrefectureCode | null;
  name: string;
  body: string;
}

const PREFECTURE_NAMES = new Map<string, string>(
  PREFECTURES.map(({ code, name }) => [code, name]),
);

export function prefectureName(code: string | null): string | null {
  return code === null ? null : (PREFECTURE_NAMES.get(code) ?? null);
}

export function isPrefectureCode(value: string): value is PrefectureCode {
  return PREFECTURE_NAMES.has(value);
}

export function countCodePoints(value: string): number {
  return Array.from(value).length;
}

function cleanText(value: string): string {
  const normalizedControls = value.replace(/\r\n?/g, '\n').replace(/\t/g, ' ');
  const safeCharacters = Array.from(normalizedControls).filter((character) => {
    const codePoint = character.codePointAt(0)!;
    const isC0Control =
      (codePoint >= 0 && codePoint <= 31 && codePoint !== 10) ||
      codePoint === 127;
    const isInvisible =
      codePoint === 0x200b ||
      codePoint === 0x200c ||
      codePoint === 0x2060 ||
      codePoint === 0xfeff;
    const isBidiControl =
      (codePoint >= 0x202a && codePoint <= 0x202e) ||
      (codePoint >= 0x2066 && codePoint <= 0x2069);
    return !isC0Control && !isInvisible && !isBidiControl;
  });
  return safeCharacters.join('').normalize('NFC').trim();
}

export function validateProposal(
  input: unknown,
):
  | { ok: true; value: NormalizedProposal }
  | { ok: false; errors: ProposalValidationError[] } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return {
      ok: false,
      errors: [
        { field: 'kind', code: 'invalid' },
        { field: 'name', code: 'required' },
        { field: 'body', code: 'required' },
      ],
    };
  }
  const record = input as Record<string, unknown>;
  const errors: ProposalValidationError[] = [];
  const kind =
    record.kind === 'local' || record.kind === 'original'
      ? record.kind
      : undefined;
  if (!kind) errors.push({ field: 'kind', code: 'invalid' });

  const rawPrefecture = record.prefectureCode;
  const prefectureCode =
    rawPrefecture === undefined || rawPrefecture === null
      ? null
      : typeof rawPrefecture === 'string' && isPrefectureCode(rawPrefecture)
        ? rawPrefecture
        : undefined;
  if (prefectureCode === undefined) {
    errors.push({ field: 'prefectureCode', code: 'invalid' });
  } else if (kind === 'original' && prefectureCode !== null) {
    errors.push({ field: 'prefectureCode', code: 'not_allowed' });
  }

  const name = typeof record.name === 'string' ? cleanText(record.name) : '';
  const body = typeof record.body === 'string' ? cleanText(record.body) : '';
  if (name.length === 0) {
    errors.push({ field: 'name', code: 'required' });
  } else {
    if (name.includes('\n')) {
      errors.push({ field: 'name', code: 'newline_not_allowed' });
    }
    if (countCodePoints(name) > PROPOSAL_NAME_MAX_LENGTH) {
      errors.push({ field: 'name', code: 'too_long' });
    }
  }
  if (body.length === 0) {
    errors.push({ field: 'body', code: 'required' });
  } else if (countCodePoints(body) > PROPOSAL_BODY_MAX_LENGTH) {
    errors.push({ field: 'body', code: 'too_long' });
  }

  if (errors.length > 0 || !kind || prefectureCode === undefined) {
    return { ok: false, errors };
  }
  return {
    ok: true,
    value: { kind, prefectureCode, name, body },
  };
}

export function proposalDedupText(proposal: NormalizedProposal): string {
  const normalize = (value: string) =>
    value.normalize('NFKC').toLocaleLowerCase('ja-JP').replace(/\s+/gu, ' ');
  return [
    proposal.kind,
    normalize(proposal.name),
    normalize(proposal.body),
  ].join('\u0000');
}

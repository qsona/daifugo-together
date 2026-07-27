import {
  countCodePoints,
  PREFECTURES,
  PROPOSAL_BODY_MAX_LENGTH,
  PROPOSAL_NAME_MAX_LENGTH,
  validateProposal,
  type CreateProposalRequest,
  type ProposalListItem,
  type ProposalValidationError,
  type YellowCardInfo,
} from '@daifugo/core';
import { useState, type FormEvent } from 'react';

import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { Callout } from '../components/Callout';
import { SegmentedControl } from '../components/SegmentedControl';
import { YellowCardModal } from '../components/YellowCardModal';
import type { ProposalApi } from '../proposal/client';
import { ProposalApiError } from '../proposal/client';

import styles from './ProposalFormScreen.module.css';
import screen from './screen.module.css';

const ERROR_MESSAGES: Record<ProposalValidationError['code'], string> = {
  required: '入力してください',
  invalid: '正しい値を選んでください',
  too_long: '文字数の上限を超えています',
  not_allowed: 'オリジナルルールには都道府県を指定できません',
  newline_not_allowed: 'ルール名は1行で入力してください',
};

function clampCodePoints(value: string, maximum: number): string {
  return Array.from(value.normalize('NFC')).slice(0, maximum).join('');
}

export function ProposalFormScreen({
  api,
  onBack,
}: {
  api: ProposalApi;
  onBack: () => void;
}) {
  const [kind, setKind] = useState<'local' | 'original'>('local');
  const [prefectureCode, setPrefectureCode] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [errors, setErrors] = useState<ProposalValidationError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [accepted, setAccepted] = useState<ProposalListItem | null>(null);
  const [yellowCard, setYellowCard] = useState<Extract<
    YellowCardInfo,
    { verdict: 'card' }
  > | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const fieldError = (field: ProposalValidationError['field']) => {
    const error = errors.find((candidate) => candidate.field === field);
    return error ? ERROR_MESSAGES[error.code] : null;
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    setAccepted(null);
    setYellowCard(null);
    const request: CreateProposalRequest = {
      kind,
      prefectureCode: kind === 'local' ? prefectureCode || null : null,
      name,
      body,
    };
    const validation = validateProposal(request);
    if (!validation.ok) {
      setErrors(validation.errors);
      return;
    }
    setErrors([]);
    setSubmitting(true);
    try {
      const response = await api.submit(request);
      if (response.outcome === 'accepted') {
        setAccepted(response.proposal);
        return;
      }
      if (response.yellowCard.verdict === 'card') {
        setYellowCard(response.yellowCard);
      } else {
        setMessage(response.yellowCard.message);
      }
    } catch (error) {
      if (error instanceof ProposalApiError) {
        setErrors(error.fields);
        setMessage(error.message);
      } else {
        setMessage('提案を送信できませんでした');
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className={screen.screen}>
      <AppBar title="ルールをていあんする" onBack={onBack} />
      <main className={screen.body}>
        <form className={styles.form} onSubmit={(event) => void submit(event)}>
          <div className={styles.field}>
            <span className={styles.label}>ルールの区分</span>
            <SegmentedControl
              label="ルールの区分"
              options={[
                { value: 'local', label: 'ローカルルール' },
                { value: 'original', label: 'オリジナルルール' },
              ]}
              value={kind}
              onChange={(next) => {
                setKind(next);
                if (next === 'original') setPrefectureCode('');
              }}
            />
          </div>

          {kind === 'local' && (
            <label className={styles.field}>
              <span className={styles.label}>遊んでいた都道府県（任意）</span>
              <select
                className={styles.control}
                value={prefectureCode}
                onChange={(event) => setPrefectureCode(event.target.value)}
              >
                <option value="">選択しない</option>
                {PREFECTURES.map((prefecture) => (
                  <option key={prefecture.code} value={prefecture.code}>
                    {prefecture.name}
                  </option>
                ))}
              </select>
              {fieldError('prefectureCode') && (
                <span className={styles.error}>
                  {fieldError('prefectureCode')}
                </span>
              )}
            </label>
          )}

          <label className={styles.field}>
            <span className={styles.labelRow}>
              <span className={styles.label}>ルール名</span>
              <span className={styles.counter}>
                {countCodePoints(name)} / {PROPOSAL_NAME_MAX_LENGTH}
              </span>
            </span>
            <input
              className={styles.control}
              aria-label="ルール名"
              value={name}
              placeholder="例: 8切り"
              maxLength={PROPOSAL_NAME_MAX_LENGTH * 2}
              aria-invalid={fieldError('name') !== null}
              onChange={(event) =>
                setName(
                  clampCodePoints(event.target.value, PROPOSAL_NAME_MAX_LENGTH),
                )
              }
            />
            {fieldError('name') && (
              <span className={styles.error}>{fieldError('name')}</span>
            )}
          </label>

          <label className={styles.field}>
            <span className={styles.labelRow}>
              <span className={styles.label}>ルールの内容</span>
              <span className={styles.counter}>
                {countCodePoints(body)} / {PROPOSAL_BODY_MAX_LENGTH}
              </span>
            </span>
            <textarea
              className={`${styles.control} ${styles.textarea}`}
              aria-label="ルールの内容"
              value={body}
              placeholder="例: 8を出すと場が流れて、出した人からもう一度はじまる。"
              maxLength={PROPOSAL_BODY_MAX_LENGTH * 2}
              aria-invalid={fieldError('body') !== null}
              onChange={(event) =>
                setBody(
                  clampCodePoints(event.target.value, PROPOSAL_BODY_MAX_LENGTH),
                )
              }
            />
            {fieldError('body') && (
              <span className={styles.error}>{fieldError('body')}</span>
            )}
          </label>

          {message && (
            <p role="alert" className={styles.error}>
              {message}
            </p>
          )}
          {accepted && (
            <div className={styles.accepted} role="status">
              <span className={styles.acceptedName}>{accepted.name}</span>
              <span className={styles.status}>審査中</span>
            </div>
          )}
          {!accepted && (
            <Button type="submit" variant="primary" block disabled={submitting}>
              {submitting ? '送信中…' : '提案を送信する'}
            </Button>
          )}
          <Callout>
            提案はAIが審査します。不正な命令はイエローカードの対象です。都道府県は遊んでいた記録として残ります。
          </Callout>
        </form>
      </main>
      {yellowCard && (
        <YellowCardModal
          info={yellowCard}
          onClose={() => setYellowCard(null)}
        />
      )}
    </div>
  );
}

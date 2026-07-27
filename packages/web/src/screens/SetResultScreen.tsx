import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { MoodPicker } from '../components/MoodPicker';
import { RankRows } from '../components/RankRow';
import type { RankView } from '../components/RankRow';
import { VoteButton } from '../components/VoteButton';

import styles from './SetResultScreen.module.css';
import screen from './screen.module.css';

export type SetFunRating = 'fun' | 'neutral' | 'boring';
export type RuleVote = 'up' | 'down' | null;

/** このセットで発動したルールと、現在の評価状態。 */
export type FiredRuleVote = {
  ruleId: string;
  name: string;
  vote: RuleVote;
};

type SetResultScreenProps = {
  ranks: readonly RankView[];
  funRating: SetFunRating | null;
  firedRules: readonly FiredRuleVote[];
  onChangeFunRating: (rating: SetFunRating) => void;
  onVoteRule: (ruleId: string, vote: RuleVote) => void;
  onPlayAgain: () => void;
  onPlayCommunity?: () => void;
  emphasizePlayCommunity?: boolean;
  onHome: () => void;
  showEvaluation?: boolean;
  waitingFor?: readonly string[] | null;
};

/**
 * 画面 5b: セットリザルト+評価。
 * 表示と入力のトーンのみを担当し、集計・保存・淘汰は E8/E9 の関心。
 * 評価の単位は「このゲーム」ではなく「このセット(3 戦)」(企画書 §4.4)。
 */
export function SetResultScreen({
  ranks,
  funRating,
  firedRules,
  onChangeFunRating,
  onVoteRule,
  onPlayAgain,
  onPlayCommunity,
  emphasizePlayCommunity = false,
  onHome,
  showEvaluation = true,
  waitingFor = null,
}: SetResultScreenProps) {
  return (
    <div className={screen.screen}>
      <AppBar title="セットリザルト" />
      <main className={screen.body}>
        {/* 見出しは AppBar と順位行が語っているので置かない。 */}
        <RankRows ranks={ranks} />

        {showEvaluation && (
          <>
            {/* この画面に残す唯一の文。問いなので消せない。 */}
            <h2 className={screen.sectionTitle}>おもしろかった?</h2>
            <MoodPicker
              label="このセットはおもしろかった?"
              value={funRating}
              onChange={onChangeFunRating}
              options={[
                { value: 'fun', label: 'おもしろかった' },
                { value: 'neutral', label: 'ふつう' },
                { value: 'boring', label: 'つまらなかった' },
              ]}
            />
          </>
        )}

        {firedRules.length > 0 && (
          <>
            {/*
             * 「を評価」は 高評価/低評価 ボタンが並んでいる時点で自明なので名詞だけにする。
             * 使い方のヒント文は置かない(操作対象の上流の説明は読まれない。原則 1)。
             */}
            <h2 className={screen.sectionTitle}>発動したルール</h2>
            <ul className={styles.ruleVotes}>
              {firedRules.map((rule) => (
                <li key={rule.ruleId} className={styles.ruleVote}>
                  <span className={styles.ruleName}>{rule.name}</span>
                  {showEvaluation && (
                    <>
                      <VoteButton
                        direction="up"
                        selected={rule.vote === 'up'}
                        onClick={() => {
                          onVoteRule(
                            rule.ruleId,
                            rule.vote === 'up' ? null : 'up',
                          );
                        }}
                      />
                      <VoteButton
                        direction="down"
                        selected={rule.vote === 'down'}
                        onClick={() => {
                          onVoteRule(
                            rule.ruleId,
                            rule.vote === 'down' ? null : 'down',
                          );
                        }}
                      />
                    </>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
        {/*
         * 「低評価が集まると排除される」の置き場は図鑑の「排除済み」行とあそびかた。
         * まだ起きていない結果をここで予告しない(原則 4)。
         */}

        <div className={screen.footer}>
          {waitingFor && waitingFor.length > 0 && (
            <p role="status">{waitingFor.join('、')} を待っています…</p>
          )}
          {/*
           * 評価はボタンを押した時点で送信済み(押した状態が残ることが確認そのもの)。
           * だから CTA は次の行動だけを言う。1 ボタン 1 動作。
           */}
          <Button
            variant={emphasizePlayCommunity ? 'secondary' : 'primary'}
            block
            disabled={waitingFor !== null}
            onClick={onPlayAgain}
          >
            {waitingFor === null ? 'もう1セットあそぶ' : '待っています…'}
          </Button>
          {onPlayCommunity && (
            <Button
              variant={emphasizePlayCommunity ? 'primary' : 'secondary'}
              block
              onClick={onPlayCommunity}
            >
              みんなのルールで あそんでみる
            </Button>
          )}
          <Button block onClick={onHome}>
            ホームへ
          </Button>
        </div>
      </main>
    </div>
  );
}

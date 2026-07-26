import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { Callout } from '../components/Callout';
import { RankRows } from '../components/RankRow';
import type { RankView } from '../components/RankRow';
import { SegmentedControl } from '../components/SegmentedControl';
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
  onHome: () => void;
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
  onHome,
}: SetResultScreenProps) {
  return (
    <div className={screen.screen}>
      <AppBar title="セットリザルト(全3戦)" />
      <main className={screen.body}>
        <h2 className={screen.sectionTitle}>3 戦の総合結果</h2>
        <RankRows ranks={ranks} />

        <h2 className={screen.sectionTitle}>このセットはおもしろかった?</h2>
        <SegmentedControl
          label="このセットはおもしろかった?"
          size="mini"
          value={funRating}
          onChange={onChangeFunRating}
          options={[
            { value: 'fun', label: 'おもしろかった' },
            { value: 'neutral', label: 'ふつう' },
            { value: 'boring', label: 'つまらなかった' },
          ]}
        />

        <h2 className={screen.sectionTitle}>
          このセットで発動したルールを評価
        </h2>
        <p className={styles.hint}>
          よかったルールには高評価、つまらなかったルールには低評価。
        </p>
        <ul className={styles.ruleVotes}>
          {firedRules.map((rule) => (
            <li key={rule.ruleId} className={styles.ruleVote}>
              <span className={styles.ruleName}>{rule.name}</span>
              <VoteButton
                direction="up"
                selected={rule.vote === 'up'}
                onClick={() => {
                  onVoteRule(rule.ruleId, rule.vote === 'up' ? null : 'up');
                }}
              />
              <VoteButton
                direction="down"
                selected={rule.vote === 'down'}
                onClick={() => {
                  onVoteRule(rule.ruleId, rule.vote === 'down' ? null : 'down');
                }}
              />
            </li>
          ))}
        </ul>
        <Callout>
          対象はこのセットで発動したルールのみ。低評価が集まったルールは排除されます。
        </Callout>

        <div className={screen.footer}>
          <Button variant="primary" block onClick={onPlayAgain}>
            評価を送信してもう1セットあそぶ
          </Button>
          <Button block onClick={onHome}>
            ホームへ
          </Button>
        </div>
      </main>
    </div>
  );
}

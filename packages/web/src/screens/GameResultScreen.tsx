import { AppBar } from '../components/AppBar';
import { Button } from '../components/Button';
import { RankRows } from '../components/RankRow';
import type { RankView } from '../components/RankRow';

import screen from './screen.module.css';

type GameResultScreenProps = {
  /** 「第1戦 おわり」。 */
  title: string;
  /** 「セット 1 / 3 戦」。 */
  progressLabel: string;
  ranks: readonly RankView[];
  /** 「第2戦へ(5 秒後に自動で進む)」。 */
  nextLabel: string;
  onNext: () => void;
};

/**
 * 画面 5a: ゲーム間リザルト(簡易)。
 * 評価入力は置かず、テンポよく次戦へ進める(評価はセットの最後にまとめて行う)。
 */
export function GameResultScreen({
  title,
  progressLabel,
  ranks,
  nextLabel,
  onNext,
}: GameResultScreenProps) {
  return (
    <div className={screen.screen}>
      <AppBar title={title} action={{ label: progressLabel }} />
      <main className={screen.body}>
        {/*
         * 見出しは AppBar と重複するので置かない。
         * 「同じメンバーで続く」「評価はあとでまとめて」はどちらも予告で、
         * 次戦が始まれば分かる・評価画面に着けば分かる(UI文言ガイド 原則 4)。
         */}
        <RankRows ranks={ranks} />
        <div className={screen.footer}>
          <Button variant="primary" block onClick={onNext}>
            {nextLabel}
          </Button>
        </div>
      </main>
    </div>
  );
}

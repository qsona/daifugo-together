import { AppBar } from '../components/AppBar';
import { CountdownButton } from '../components/CountdownButton';
import { GameRankRows } from '../components/GameRankRows';
import type { GameRankView } from '../components/GameRankRows';

import screen from './screen.module.css';

type GameResultScreenProps = {
  /** 「第1戦 おわり」。 */
  title: string;
  /** 「セット 1 / 3 戦」。 */
  progressLabel: string;
  ranks: readonly GameRankView[];
  nextLabel: string;
  /** サーバーが決めた、自動で次戦へ進むまでの総時間。 */
  autoAdvanceMs: number;
  /** サーバーが決めた自動進行時刻。再接続後もバーの残量を一致させる。 */
  autoAdvanceAt: number;
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
  autoAdvanceMs,
  autoAdvanceAt,
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
        <GameRankRows ranks={ranks} />
        <div className={screen.footer}>
          {/* 「5 秒後に自動で進む」という文の代わりに、縁のリングが残り時間を見せる。 */}
          <CountdownButton
            durationMs={autoAdvanceMs}
            deadlineAt={autoAdvanceAt}
            onActivate={onNext}
          >
            {nextLabel}
          </CountdownButton>
        </div>
      </main>
    </div>
  );
}

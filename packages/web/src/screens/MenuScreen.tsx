import { BrandHero, HillDivider } from '../components/BrandHero';
import { Button } from '../components/Button';

import styles from './MenuScreen.module.css';
import screen from './screen.module.css';

type MenuScreenProps = {
  onPlay: () => void;
  onPropose: () => void;
  onEncyclopedia: () => void;
  onMyProposals: () => void;
  onHowToPlay: () => void;
};

/**
 * 画面 1b: メニュー。
 * ワイヤーの情報構造(ロゴ小 / 主要 3 導線 / 補助 2 導線 / コンセプト一文)を維持する。
 */
export function MenuScreen({
  onPlay,
  onPropose,
  onEncyclopedia,
  onMyProposals,
  onHowToPlay,
}: MenuScreenProps) {
  return (
    <div className={screen.screen}>
      <main className={screen.body}>
        <BrandHero />
        <Button variant="primary" block onClick={onPlay}>
          あそぶ
        </Button>
        <Button block onClick={onPropose}>
          ルールをていあんする
        </Button>
        <Button block onClick={onEncyclopedia}>
          ルール図鑑
        </Button>
        <div className={screen.row}>
          <Button size="small" onClick={onMyProposals}>
            マイ提案
          </Button>
          <Button size="small" onClick={onHowToPlay}>
            あそびかた
          </Button>
        </div>
        <p className={styles.note}>
          はじめは基本ルールだけの「素の大富豪」。
          <br />
          みんなの提案で、ルールはどんどん増えていく。
        </p>
        <HillDivider />
      </main>
    </div>
  );
}

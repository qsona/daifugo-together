import { BrandHero, HillDivider } from '../components/BrandHero';
import { Button } from '../components/Button';

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
 * ロゴ小 / 主要 3 導線 / 補助 2 導線。コンセプトの一文はキービジュアルの
 * コピーが既に言っているので画面には置かない(UI文言ガイド 原則 3)。
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
        <HillDivider />
      </main>
    </div>
  );
}

import type { GuideCue } from '../game/guide';

export function GuideMessage({ cue }: { cue: GuideCue }) {
  switch (cue) {
    case 'firstTurn':
      return 'すきなカードを 1 枚 えらんで出そう';
    case 'followTurn':
      return '場のカードより つよいカードなら 出せるよ';
    case 'pairAvailable':
      return 'おなじ数字は 2 枚 いっしょに出せるよ';
    case 'noLegalMove':
      return '出せないときは「パス」';
    case 'fieldCleared':
      return 'みんながパスしたので 場がながれた! つぎは きみから';
  }
}

import type { GuideCue } from '../game/guide';

export function GuideMessage({ cue }: { cue: GuideCue }) {
  switch (cue) {
    case 'firstTurn':
      return (
        <>
          すきなカードを 1{' '}
          <ruby>
            枚<rt>まい</rt>
          </ruby>{' '}
          えらんで
          <ruby>
            出<rt>だ</rt>
          </ruby>
          そう
        </>
      );
    case 'followTurn':
      return (
        <>
          <ruby>
            場<rt>ば</rt>
          </ruby>
          のカードより つよいカードなら{' '}
          <ruby>
            出<rt>だ</rt>
          </ruby>
          せるよ
        </>
      );
    case 'pairAvailable':
      return (
        <>
          おなじ
          <ruby>
            数字<rt>すうじ</rt>
          </ruby>
          は 2
          <ruby>
            枚<rt>まい</rt>
          </ruby>{' '}
          いっしょに
          <ruby>
            出<rt>だ</rt>
          </ruby>
          せるよ
        </>
      );
    case 'noLegalMove':
      return (
        <>
          <ruby>
            出<rt>だ</rt>
          </ruby>
          せないときは「パス」
        </>
      );
    case 'fieldCleared':
      return (
        <>
          みんながパスしたので{' '}
          <ruby>
            場<rt>ば</rt>
          </ruby>
          が ながれた! つぎは きみから
        </>
      );
  }
}

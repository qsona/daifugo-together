import { AppBar } from '../components/AppBar';

import styles from './RuleBalanceNoticeScreen.module.css';
import screen from './screen.module.css';

type RuleChange = {
  name: string;
  before: string;
  after: string;
  reason: string;
};

const RULE_CHANGES: RuleChange[] = [
  {
    name: 'ラッキー7',
    before: '自然な7を2枚以上同時に出すと、出した自然な7の枚数分を捨てる',
    after: '自然な7を3枚以上同時に出すと、残り手札から1枚を必ずえらんで捨てる',
    reason: '7渡しと重なると、一度に手札を減らせる効果が強すぎたためです。',
  },
  {
    name: 'ボンバーマン',
    before: '階段を出すと、その階段の構成枚数分を捨てる',
    after:
      '階段を出すと、構成枚数にかかわらず残り手札から1枚を必ずえらんで捨てる',
    reason: '長い階段ほど大量に手札を捨てられ、1回の効果が大きすぎたためです。',
  },
  {
    name: 'リアルボンバー',
    before: '自然な4を1枚で出すたびに発動する',
    after:
      '1セットの全プレイヤーを通じて最初の1回だけ発動する。次のセットでは再び発動できる',
    reason:
      '同じセットで何度もミニゲームが始まると、大富豪の進行が途切れやすいためです。',
  },
];

function displayReleaseDate(value: string | null): string | null {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value ?? '');
  if (!matched) return null;
  const year = Number(matched[1]);
  const month = Number(matched[2]);
  const day = Number(matched[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return `${String(year)}年${String(month)}月${String(day)}日`;
}

export function RuleBalanceNoticeScreen({
  releasedOn,
  onBack,
}: {
  releasedOn: string | null;
  onBack: () => void;
}) {
  const releaseDate = displayReleaseDate(releasedOn);

  return (
    <div className={screen.screen}>
      <AppBar title="ルール調整のお知らせ" onBack={onBack} />
      <main className={screen.body}>
        <header className={styles.intro}>
          <p className={styles.date}>
            {releaseDate
              ? `反映日: ${releaseDate}`
              : '反映日を確認できませんでした'}
          </p>
          <p className={styles.lead}>
            対局のテンポと、カードを捨てる効果の強さを整えるため、3つのルールを調整しました。ルールのおもしろさは残しながら、1回の発動で有利になりすぎたり、ミニゲームが続きすぎたりしないようにしています。
          </p>
        </header>
        <div className={styles.rules}>
          {RULE_CHANGES.map((change) => (
            <section key={change.name} className={styles.rule}>
              <h2>{change.name}</h2>
              <dl className={styles.changes}>
                <div>
                  <dt>変更前</dt>
                  <dd>{change.before}</dd>
                </div>
                <div className={styles.after}>
                  <dt>変更後</dt>
                  <dd>{change.after}</dd>
                </div>
              </dl>
              <div className={styles.reason}>
                <h3>変更理由</h3>
                <p>{change.reason}</p>
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}

import styles from './BrandHero.module.css';

/** ガーランドの旗色。意味割り当てのない装飾なのでプリミティブ直参照(命名規約 §3.1)。 */
const FLAG_COLORS = [
  'var(--color-red-500)',
  'var(--color-gold-400)',
  'var(--color-cream-100)',
  'var(--color-green-500)',
  'var(--color-red-500)',
  'var(--color-gold-400)',
  'var(--color-green-500)',
  'var(--color-cream-100)',
  'var(--color-red-500)',
  'var(--color-gold-400)',
  'var(--color-green-500)',
];

const LOGO_CHARS = [
  { char: '大', x: 66, fill: 'var(--color-red-500)' },
  { char: '富', x: 170, fill: 'var(--color-gold-400)' },
  { char: '豪', x: 274, fill: 'var(--color-green-500)' },
];

/**
 * 画面 1b 以降で使うロゴ(小)。
 * 造形は 2A の文法どおり: 直立の極太ロゴ + 多層縁 + ベタ落ち影、傾けない。
 */
export function BrandHero() {
  return (
    <div className={styles.hero}>
      <div className={styles.garland} aria-hidden="true">
        {FLAG_COLORS.map((color, index) => (
          <i
            key={index}
            className={styles.flag}
            style={{ background: color }}
          />
        ))}
      </div>
      <svg
        viewBox="0 0 340 132"
        className={styles.logo}
        role="img"
        aria-label="みんなでつくろう 大富豪"
      >
        <text
          x="170"
          y="30"
          fontSize="24"
          fontWeight="bold"
          textAnchor="middle"
          letterSpacing="2"
          fill="var(--color-white)"
          stroke="var(--color-navy-800)"
          strokeWidth="6"
          paintOrder="stroke"
          strokeLinejoin="round"
        >
          みんなでつくろう
        </text>
        <g fontSize="72" fontWeight="bold" textAnchor="middle">
          {/* ベタ落ち影 */}
          <g
            transform="translate(3,4)"
            stroke="var(--color-navy-900)"
            strokeWidth="12"
            strokeLinejoin="round"
            fill="var(--color-navy-900)"
          >
            {LOGO_CHARS.map(({ char, x }) => (
              <text key={char} x={x} y="108">
                {char}
              </text>
            ))}
          </g>
          {/* 紺の輪郭 */}
          <g
            stroke="var(--color-navy-800)"
            strokeWidth="12"
            strokeLinejoin="round"
            fill="var(--color-navy-800)"
          >
            {LOGO_CHARS.map(({ char, x }) => (
              <text key={char} x={x} y="108">
                {char}
              </text>
            ))}
          </g>
          {/* クリームの内縁 + 色面 */}
          <g
            stroke="var(--color-cream-100)"
            strokeWidth="5"
            strokeLinejoin="round"
            paintOrder="stroke"
          >
            {LOGO_CHARS.map(({ char, x, fill }) => (
              <text key={char} x={x} y="108" fill={fill}>
                {char}
              </text>
            ))}
          </g>
        </g>
      </svg>
    </div>
  );
}

/** 画面下端の丘。KV の丘の続きとして敷く。 */
export function HillDivider() {
  return (
    <div className={styles.hill} aria-hidden="true">
      <svg
        viewBox="0 0 375 56"
        className={styles.hillSvg}
        preserveAspectRatio="none"
      >
        <path
          d="M0,34 Q 95,10 190,26 Q 285,42 375,20 L375,56 L0,56 Z"
          fill="var(--color-green-500)"
        />
        <path
          d="M0,46 Q 120,30 230,42 Q 310,50 375,40 L375,56 L0,56 Z"
          fill="var(--color-green-600)"
        />
      </svg>
    </div>
  );
}

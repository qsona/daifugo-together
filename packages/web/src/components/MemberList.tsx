import { cx } from '../lib/cx';

import { Tag } from './Tag';
import styles from './MemberList.module.css';

/** 待機画面の 1 席が表示する内容だけを持つ view-model。 */
export type MemberView =
  | { kind: 'human'; name: string; role?: string }
  | { kind: 'ai'; name: string }
  | { kind: 'empty' };

function PersonIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="var(--color-navy-600)"
      aria-hidden="true"
    >
      <circle cx="8" cy="5.5" r="3" />
      <path d="M2 14c.6-3 3-4.5 6-4.5s5.4 1.5 6 4.5z" />
    </svg>
  );
}

/** 4 人固定・AI 自動補充(企画書 §3.2)。空き枠も席として並べる。 */
export function MemberList({ members }: { members: readonly MemberView[] }) {
  return (
    <ul className={styles.list}>
      {members.map((member, index) => (
        <li
          key={index}
          className={cx(styles.slot, member.kind === 'empty' && styles.empty)}
        >
          <span className={styles.avatar}>
            {member.kind !== 'empty' && <PersonIcon />}
          </span>
          <span className={styles.name}>
            {member.kind === 'empty' ? '(あき)' : member.name}
            {member.kind === 'human' && member.role && (
              <small className={styles.role}>{member.role}</small>
            )}
          </span>
          {member.kind === 'human' && <Tag variant="human">人間</Tag>}
          {member.kind === 'ai' && <Tag variant="ai">AI</Tag>}
          {member.kind === 'empty' && (
            <Tag variant="ai">開始時にAIが入ります</Tag>
          )}
        </li>
      ))}
    </ul>
  );
}

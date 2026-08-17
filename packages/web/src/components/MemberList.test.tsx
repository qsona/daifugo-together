import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import styles from './MemberList.module.css';
import { MemberList } from './MemberList';

afterEach(cleanup);

describe('MemberList', () => {
  it('自分の表示名を保ち、色付きの席と「自分」で示す', () => {
    render(
      <MemberList
        members={[
          { kind: 'human', name: 'たろう', isSelf: true, role: 'ホスト' },
          { kind: 'human', name: 'はなこ' },
        ]}
      />,
    );

    const self = screen.getByLabelText('たろう（自分）');
    expect(self.classList.contains(styles.self!)).toBe(true);
    expect(screen.getByText('たろう')).toBeTruthy();
    expect(screen.getByText('自分')).toBeTruthy();
    expect(screen.queryByText('あなた')).toBeNull();
  });
});

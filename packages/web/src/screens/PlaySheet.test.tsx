import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PlaySheet } from './PlaySheet';

afterEach(cleanup);

describe('TU-01: あそぶ導線の選択', () => {
  it('最初に「だれとあそぶか」を聞き、みんなのルールを主ボタンにする', () => {
    render(<PlaySheet onCreate={vi.fn()} onJoin={vi.fn()} onClose={vi.fn()} />);

    expect(
      screen.getByRole('dialog', { name: 'あそびかたをえらぶ' }),
    ).toBeTruthy();
    const choices = screen.getAllByRole('button');
    expect(choices).toHaveLength(2);
    expect(choices[0]?.textContent).toBe('みんなのルールであそぶ');
    expect(choices[0]?.className).toContain('primary');
    expect(choices[1]?.textContent).toContain('きほんルールで練習する');
    expect(choices[1]?.className).not.toContain('primary');
  });

  it('きほんルールで練習するには初心者アイコンとキャプションを添える', () => {
    render(<PlaySheet onCreate={vi.fn()} onJoin={vi.fn()} onClose={vi.fn()} />);

    // キャプションは説明として渡し、アクセシブル名には混ぜない。
    const practice = screen.getByRole('button', {
      name: 'きほんルールで練習する',
    });
    expect(practice.querySelector('svg')).toBeTruthy();
    const caption = screen.getByText('大富豪がはじめての人はこちら');
    expect(practice.getAttribute('aria-describedby')).toBe(caption.id);
  });

  it('きほんルールで練習するを選ぶとすぐ きほん の部屋を作る', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <PlaySheet onCreate={onCreate} onJoin={vi.fn()} onClose={vi.fn()} />,
    );

    await user.click(
      screen.getByRole('button', { name: 'きほんルールで練習する' }),
    );

    expect(onCreate).toHaveBeenCalledWith('basic');
  });

  it('みんなのルールを選ぶと部屋を立てるか入るかの2段目へ進む', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <PlaySheet onCreate={onCreate} onJoin={vi.fn()} onClose={vi.fn()} />,
    );

    await user.click(
      screen.getByRole('button', { name: 'みんなのルールであそぶ' }),
    );

    expect(
      screen.getByRole('dialog', { name: 'みんなのルールであそぶ' }),
    ).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
    const choices = screen.getAllByRole('button');
    expect(choices[0]?.textContent).toBe('部屋を立てる');
    expect(choices[0]?.className).toContain('primary');
    expect(choices[1]?.textContent).toBe('友だちの部屋にはいる');

    await user.click(screen.getByRole('button', { name: '部屋を立てる' }));
    expect(onCreate).toHaveBeenCalledWith('community');
  });

  it('2段目からもどると「だれとあそぶか」に戻る', async () => {
    const user = userEvent.setup();
    render(<PlaySheet onCreate={vi.fn()} onJoin={vi.fn()} onClose={vi.fn()} />);

    await user.click(
      screen.getByRole('button', { name: 'みんなのルールであそぶ' }),
    );
    await user.click(screen.getByRole('button', { name: 'もどる' }));

    expect(
      screen.getByRole('button', { name: 'きほんルールで練習する' }),
    ).toBeTruthy();
  });

  it('友だちの部屋には招待コードだけで入れ、モードは要求しない', async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn();
    render(<PlaySheet onCreate={vi.fn()} onJoin={onJoin} onClose={vi.fn()} />);

    await user.click(
      screen.getByRole('button', { name: 'みんなのルールであそぶ' }),
    );
    await user.click(
      screen.getByRole('button', { name: '友だちの部屋にはいる' }),
    );
    const inviteCodeInput = screen.getByLabelText(
      '招待コード',
    ) as HTMLInputElement;
    expect(inviteCodeInput.getAttribute('inputmode')).toBe('numeric');
    await user.type(inviteCodeInput, '0A12-3456');
    expect(inviteCodeInput.value).toBe('01234');
    await user.click(screen.getByRole('button', { name: 'はいる' }));
    expect(onJoin).toHaveBeenCalledWith('01234');
  });

  it('参加フォームからもどると みんなのルール の2段目に戻る', async () => {
    const user = userEvent.setup();
    render(<PlaySheet onCreate={vi.fn()} onJoin={vi.fn()} onClose={vi.fn()} />);

    await user.click(
      screen.getByRole('button', { name: 'みんなのルールであそぶ' }),
    );
    await user.click(
      screen.getByRole('button', { name: '友だちの部屋にはいる' }),
    );
    await user.click(screen.getByRole('button', { name: 'もどる' }));

    expect(screen.getByRole('button', { name: '部屋を立てる' })).toBeTruthy();
  });

  it('匿名ユーザーは友だちの部屋へ入る前になまえを設定できる', async () => {
    const user = userEvent.setup();
    const onJoin = vi.fn();
    render(
      <PlaySheet
        anonymousDisplayName="ゲスト000001"
        onCreate={vi.fn()}
        onJoin={onJoin}
        onClose={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'みんなのルールであそぶ' }),
    );
    await user.click(
      screen.getByRole('button', { name: '友だちの部屋にはいる' }),
    );
    const nameInput = screen.getByLabelText('なまえ') as HTMLInputElement;
    expect(nameInput.value).toBe('ゲスト000001');

    await user.clear(nameInput);
    await user.type(nameInput, ' たろう ');
    await user.type(screen.getByLabelText('招待コード'), '01234');
    await user.click(screen.getByRole('button', { name: 'はいる' }));

    expect(onJoin).toHaveBeenCalledWith('01234', 'たろう');
  });

  it('匿名ユーザーは部屋を立てる前になまえを設定できる', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <PlaySheet
        anonymousDisplayName="ゲスト000001"
        onCreate={onCreate}
        onJoin={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'みんなのルールであそぶ' }),
    );
    await user.click(screen.getByRole('button', { name: '部屋を立てる' }));

    expect(screen.getByRole('dialog', { name: '部屋を立てる' })).toBeTruthy();
    expect(onCreate).not.toHaveBeenCalled();
    const nameInput = screen.getByLabelText('なまえ') as HTMLInputElement;
    expect(nameInput.value).toBe('ゲスト000001');

    await user.clear(nameInput);
    await user.type(nameInput, ' たろう ');
    await user.click(screen.getByRole('button', { name: '部屋を立てる' }));

    expect(onCreate).toHaveBeenCalledWith('community', 'たろう');
  });

  it('匿名の作成・参加画面には説明文なしでGoogleログインを出す', async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn();
    render(
      <PlaySheet
        anonymousDisplayName="ゲスト000001"
        onCreate={vi.fn()}
        onJoin={vi.fn()}
        onLogin={onLogin}
        onClose={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'みんなのルールであそぶ' }),
    );
    await user.click(screen.getByRole('button', { name: '部屋を立てる' }));
    expect(screen.queryByText(/前にあそんだことがある人は/u)).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Googleでログイン' }));
    expect(onLogin).toHaveBeenLastCalledWith({ kind: 'create' });

    await user.click(screen.getByRole('button', { name: 'もどる' }));
    await user.click(
      screen.getByRole('button', { name: '友だちの部屋にはいる' }),
    );
    await user.type(screen.getByLabelText('招待コード'), '01234');
    await user.click(screen.getByRole('button', { name: 'Googleでログイン' }));
    expect(onLogin).toHaveBeenLastCalledWith({
      kind: 'join',
      inviteCode: '01234',
    });
  });

  it('OAuthからの復帰では匿名の部屋作成画面から始める', () => {
    render(
      <PlaySheet
        anonymousDisplayName="ゲスト000001"
        initialStep="create"
        onCreate={vi.fn()}
        onJoin={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByRole('dialog', { name: '部屋を立てる' })).toBeTruthy();
    expect((screen.getByLabelText('なまえ') as HTMLInputElement).value).toBe(
      'ゲスト000001',
    );
  });

  it('招待リンクから開くとコード入力済みの参加フォームから始める', () => {
    render(
      <PlaySheet
        anonymousDisplayName="ゲスト000001"
        initialInviteCode="01234"
        onCreate={vi.fn()}
        onJoin={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(
      screen.getByRole('dialog', { name: '友だちの部屋にはいる' }),
    ).toBeTruthy();
    expect(
      (screen.getByLabelText('招待コード') as HTMLInputElement).value,
    ).toBe('01234');
    expect((screen.getByLabelText('なまえ') as HTMLInputElement).value).toBe(
      'ゲスト000001',
    );
  });

  it('匿名ユーザーのなまえはサーバーと同じ制約で検証する', async () => {
    const user = userEvent.setup();
    render(
      <PlaySheet
        anonymousDisplayName=""
        onCreate={vi.fn()}
        onJoin={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    await user.click(
      screen.getByRole('button', { name: 'みんなのルールであそぶ' }),
    );
    await user.click(
      screen.getByRole('button', { name: '友だちの部屋にはいる' }),
    );
    await user.type(screen.getByLabelText('招待コード'), '01234');
    const join = screen.getByRole('button', { name: 'はいる' });
    expect(join.hasAttribute('disabled')).toBe(true);

    const nameInput = screen.getByLabelText('なまえ') as HTMLInputElement;
    await user.type(nameInput, '12345678901');
    expect(nameInput.value).toBe('1234567890');
    expect(screen.getByText('10 / 10')).toBeTruthy();
    expect(join.hasAttribute('disabled')).toBe(false);

    await user.clear(nameInput);
    await user.type(nameInput, '😀😀😀😀😀😀😀😀😀😀');
    expect(join.hasAttribute('disabled')).toBe(false);
  });

  it('作成失敗を選択肢の下へ出し、その場で再試行できる', async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn();
    render(
      <PlaySheet
        onCreate={onCreate}
        onJoin={vi.fn()}
        onClose={vi.fn()}
        error="みんなのルールへ進めませんでした。もう一度ためしてください。"
      />,
    );

    expect(
      screen.getByRole('dialog', { name: 'あそびかたをえらぶ' }),
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toContain(
      'もう一度ためしてください',
    );
    await user.click(
      screen.getByRole('button', { name: 'きほんルールで練習する' }),
    );
    expect(onCreate).toHaveBeenCalledWith('basic');
  });

  it('参加の失敗はその場だけに出し、もどった先へ持ち越さない', async () => {
    const user = userEvent.setup();
    render(
      <PlaySheet
        initialInviteCode="01234"
        onCreate={vi.fn()}
        onJoin={vi.fn()}
        onClose={vi.fn()}
        error="この部屋はひとりで練習する部屋です。友だちの部屋の招待コードをたしかめてください。"
      />,
    );

    expect(screen.getByRole('alert').textContent).toContain(
      'ひとりで練習する部屋です',
    );

    await user.click(screen.getByRole('button', { name: 'もどる' }));
    expect(screen.queryByRole('alert')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'もどる' }));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('みんなのルールへの再試行では2段目から始める', () => {
    render(
      <PlaySheet
        initialMode="community"
        onCreate={vi.fn()}
        onJoin={vi.fn()}
        onClose={vi.fn()}
        error="みんなのルールへ進めませんでした。もう一度ためしてください。"
      />,
    );

    expect(
      screen.getByRole('dialog', { name: 'みんなのルールであそぶ' }),
    ).toBeTruthy();
    expect(
      screen.getByRole('button', { name: '部屋を立てる' }).className,
    ).toContain('primary');
    expect(screen.getByRole('alert').textContent).toContain(
      'もう一度ためしてください',
    );
  });

  it('途中参加するAI席の状態を表示して選べる', async () => {
    const user = userEvent.setup();
    const onTakeover = vi.fn();
    render(
      <PlaySheet
        onCreate={vi.fn()}
        onJoin={vi.fn()}
        onTakeover={onTakeover}
        onClose={vi.fn()}
        seatOptions={[
          {
            memberId: 'ai-1',
            displayName: 'AIプレイヤーA',
            previousRank: 2,
            handCount: 5,
          },
          {
            memberId: 'ai-2',
            displayName: 'AIプレイヤーB',
            previousRank: null,
            handCount: 0,
          },
        ]}
      />,
    );

    expect(
      screen.getByRole('dialog', { name: '途中参加する席をえらぶ' }),
    ).toBeTruthy();
    expect(screen.getByText('前回 富豪')).toBeTruthy();
    expect(screen.getByText('残り 5枚')).toBeTruthy();
    expect(screen.getByText('このゲームは終了済みです')).toBeTruthy();
    expect(screen.queryByText(/得点/u)).toBeNull();
    await user.click(screen.getByRole('button', { name: /AIプレイヤーA/u }));
    expect(onTakeover).toHaveBeenCalledWith('ai-1');
  });

  it('途中参加できるAI席がなければ満席と表示する', () => {
    render(
      <PlaySheet
        onCreate={vi.fn()}
        onJoin={vi.fn()}
        onClose={vi.fn()}
        seatOptions={[]}
      />,
    );

    expect(screen.getByRole('status').textContent).toBe(
      '満席のため参加できません',
    );
  });
});

import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InviteCode } from './InviteCode';

describe('InviteCode', () => {
  afterEach(cleanup);

  it('招待リンクを表示してコピーできる', async () => {
    const user = userEvent.setup();
    const onCopy = vi.fn().mockResolvedValue(undefined);

    render(
      <InviteCode
        code="01234"
        inviteUrl="https://example.com/?room=01234"
        onCopy={onCopy}
      />,
    );

    expect(screen.getByLabelText('招待リンク')).toHaveProperty(
      'value',
      'https://example.com/?room=01234',
    );
    await user.click(screen.getByRole('button', { name: 'コピー' }));
    expect(onCopy).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'コピー済み' })).toBeTruthy();
  });

  it('QRコードは必要なときだけ開き、同じリンクを持つ', async () => {
    const user = userEvent.setup();
    const { container } = render(
      <InviteCode code="01234" inviteUrl="https://example.com/?room=01234" />,
    );

    const details = container.querySelector('details');
    expect(details?.hasAttribute('open')).toBe(false);
    await user.click(screen.getByText('QRコードを表示'));
    expect(details?.hasAttribute('open')).toBe(true);
    expect(
      screen.getByRole('img', {
        name: '友だちが参加するためのQRコード',
      }),
    ).toBeTruthy();
  });
});

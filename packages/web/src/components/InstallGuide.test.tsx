import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import type { InstallEnvironment } from '../push/install';

import { InstallGuide } from './InstallGuide';

function environment(
  overrides: Partial<InstallEnvironment> = {},
): InstallEnvironment {
  return {
    ios: true,
    standalone: false,
    inApp: false,
    browser: 'safari',
    ...overrides,
  };
}

afterEach(cleanup);

describe('InstallGuide', () => {
  it('iOS Safariでは共有ボタンからの手順と再ログインの注意を出す', () => {
    render(<InstallGuide environment={environment()} />);
    expect(screen.getByText(/画面のいちばん下にある共有ボタン/u)).toBeTruthy();
    expect(screen.getByText('「ホーム画面に追加」')).toBeTruthy();
    expect(
      screen.getByText(
        /ホーム画面のアプリでもう一度Googleでログインしてください/u,
      ),
    ).toBeTruthy();
  });

  it('アプリ内ブラウザではSafariで開き直すよう案内する', () => {
    render(<InstallGuide environment={environment({ inApp: true })} />);
    expect(screen.getByText('「Safariで開く」')).toBeTruthy();
    expect(
      screen.getByText(
        'いま開いているアプリの中のブラウザからは、ホーム画面に追加できません。',
      ),
    ).toBeTruthy();
  });

  it('ホーム画面から起動していれば何も出さない', () => {
    const { container } = render(
      <InstallGuide environment={environment({ standalone: true })} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('プロンプトを持たない環境ではメニュー操作を案内する', () => {
    render(
      <InstallGuide
        environment={environment({ ios: false, browser: 'chrome' })}
      />,
    );
    expect(screen.getByText(/「アプリをインストール」/u)).toBeTruthy();
  });
});

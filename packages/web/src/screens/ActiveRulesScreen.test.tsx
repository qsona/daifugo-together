import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ActiveRulesScreen } from './ActiveRulesScreen';

afterEach(cleanup);

describe('ActiveRulesScreen', () => {
  it('ルール名だけをサーバー順で表示する', () => {
    const { container } = render(
      <ActiveRulesScreen
        rules={[
          { ruleId: 'r2', name: '二枚縛り' },
          { ruleId: 'r1', name: '8切り' },
        ]}
        onBack={vi.fn()}
        onOpenDex={vi.fn()}
      />,
    );
    expect(screen.getByText('二枚縛り')).toBeTruthy();
    expect(screen.getByText('8切り')).toBeTruthy();
    expect(container.textContent).not.toMatch(/人気|優先|都道府県|埼玉県/u);
  });

  it('0件でも空状態と図鑑導線を表示する', () => {
    render(
      <ActiveRulesScreen rules={[]} onBack={vi.fn()} onOpenDex={vi.fn()} />,
    );
    expect(screen.getByText('追加ルールはありません')).toBeTruthy();
    expect(screen.getByRole('button', { name: '図鑑でくわしく' })).toBeTruthy();
  });

  it('図鑑機能の解禁前は名称一覧だけで成立する', () => {
    render(
      <ActiveRulesScreen
        rules={[{ ruleId: 'r1', name: '8切り' }]}
        onBack={vi.fn()}
        onOpenDex={vi.fn()}
        showDexLink={false}
      />,
    );
    expect(screen.getByText('8切り')).toBeTruthy();
    expect(screen.queryByRole('button', { name: '図鑑でくわしく' })).toBeNull();
  });
});

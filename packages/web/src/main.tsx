import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// デザイントークンの正本を読み込む(以後の CSS はすべて var(--…) 経由で参照する)。
import '@design/design-tokens.css';
import './styles/global.css';

import { App } from './App';
import { watchInstallPrompt } from './push/install';
import { registerServiceWorker } from './push/register';

// beforeinstallprompt は起動直後に一度だけ飛ぶので、描画より先に受け取る(Chromium 系)。
watchInstallPrompt(window);

const container = document.getElementById('root');
if (!container) {
  throw new Error('マウント先の #root が見つかりません');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Web フォントの宣言は重いので初回描画の経路から外す(詳細は styles/fonts.ts)。
void import('./styles/fonts');
void registerServiceWorker();

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

// デザイントークンの正本を最初に読み込む(以後の CSS はすべて var(--…) 経由で参照する)。
import '@design/design-tokens.css';
import './styles/global.css';

import { App } from './App';

const container = document.getElementById('root');
if (!container) {
  throw new Error('マウント先の #root が見つかりません');
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

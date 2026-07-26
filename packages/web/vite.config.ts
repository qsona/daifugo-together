import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

/**
 * デザイン資産の正本は `docs/design/`(E04 §2.2(3)「正本を 1 つに保つ」)。
 * コピーを作らず alias で直接参照することで、正本とアプリの二重管理を構造的に防ぐ。
 */
const designDir = fileURLToPath(new URL('../../docs/design', import.meta.url));
/** pnpm はワークスペース直下の node_modules に実体を置くので、dev サーバーから読める必要がある。 */
const workspaceModules = fileURLToPath(
  new URL('../../node_modules', import.meta.url),
);

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@design': designDir,
    },
  },
  server: {
    /*
     * vite root(packages/web)の外を dev サーバーに開ける範囲。
     * 既定はワークスペース全体なので、必要な 2 つに絞っている。
     */
    fs: { allow: ['.', designDir, workspaceModules] },
  },
  test: {
    name: 'web',
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
  },
});

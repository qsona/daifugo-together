import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      reporter: ['text', 'html'],
    },
    projects: [
      {
        test: {
          name: 'node',
          environment: 'node',
          include: ['**/*.test.ts'],
          exclude: [
            '**/node_modules/**',
            '**/dist/**',
            '**/.worktrees/**',
            'packages/web/**',
          ],
        },
      },
      // packages/web は jsdom 環境と @design alias が要るので、自前の vite.config.ts を使う。
      './packages/web/vite.config.ts',
    ],
  },
});

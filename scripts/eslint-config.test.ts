import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const ruleTestPath = 'packages/rules/r9999-lint-contract/rule.test.ts';

async function lint(source: string) {
  const eslint = new ESLint();
  const [result] = await eslint.lintText(source, { filePath: ruleTestPath });
  return result?.messages ?? [];
}

describe('generated rule test lint contract', () => {
  it('同じディレクトリのrule.js importを許可する', async () => {
    const messages = await lint(
      "import { rule } from './rule.js';\nvoid rule;\n",
    );

    expect(messages).toEqual([]);
  });

  it('別の相対モジュールimportは拒否する', async () => {
    const messages = await lint(
      "import { rule } from '../other/rule.js';\nvoid rule;\n",
    );

    expect(messages).toEqual([
      expect.objectContaining({
        ruleId: 'no-restricted-imports',
        message:
          "'../other/rule.js' import is restricted from being used by a pattern. Generated rule tests may import only @daifugo/core, vitest, and ./rule.js.",
      }),
    ]);
  });
});

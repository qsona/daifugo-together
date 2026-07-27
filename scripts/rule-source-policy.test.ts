import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

async function errors(source: string, file = 'rule.ts') {
  const eslint = new ESLint({ cwd: process.cwd() });
  const [result] = await eslint.lintText(source, {
    filePath: `packages/rules/r9999-red-team/${file}`,
  });
  return result?.messages.filter((message) => message.severity === 2) ?? [];
}

describe('CX-03 generated rule source policy', () => {
  it.each([
    ['outside import', "import { readFile } from 'node:fs';\nvoid readFile;\n"],
    ['network', 'void fetch("https://example.test");\n'],
    ['time', 'void Date.now();\n'],
    ['random', 'void Math.random();\n'],
    ['dynamic import', 'void import("@daifugo/core");\n'],
    ['eval', 'void eval("1");\n'],
    ['infinite while', 'while (true) {}\n'],
    ['infinite for', 'for (;;) {}\n'],
    ['large allocation primitive', 'void new Array(1_000_000_000);\n'],
  ])('%s fixtureをlintで拒否する', async (_name, source) => {
    expect(await errors(source)).not.toHaveLength(0);
  });

  it('@daifugo/coreのtype importと決定的コードを許可する', async () => {
    expect(
      await errors(
        "import type { RuleModule } from '@daifugo/core';\nexport const rule = {} as RuleModule;\n",
      ),
    ).toEqual([]);
  });

  it('rule.test.tsではvitestを許可し、他moduleを拒否する', async () => {
    expect(
      await errors(
        "import { it } from 'vitest';\nimport type { RuleModule } from '@daifugo/core';\nvoid ({} as RuleModule); void it;\n",
        'rule.test.ts',
      ),
    ).toEqual([]);
    expect(
      await errors(
        "import { readFile } from 'node:fs';\nvoid readFile;\n",
        'rule.test.ts',
      ),
    ).not.toHaveLength(0);
  });
});

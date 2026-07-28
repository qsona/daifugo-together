import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { defaultRulesRoot } from './cli.js';

describe('simulation CLI', () => {
  it('filtered package scriptからもworkspaceのrules packageを既定値にする', () => {
    expect(
      defaultRulesRoot(pathToFileURL('/repo/packages/sim/dist/cli.js').href),
    ).toBe('/repo/packages/rules');
  });
});

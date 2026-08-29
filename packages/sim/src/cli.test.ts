import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import { defaultRulesRoot, simulationConfigurations } from './cli.js';

describe('simulation CLI', () => {
  it('filtered package scriptからもworkspaceのrules packageを既定値にする', () => {
    expect(
      defaultRulesRoot(pathToFileURL('/repo/packages/sim/dist/cli.js').href),
    ).toBe('/repo/packages/rules');
  });

  it('実行対象をPR smokeとrelease全量向けに選べる', () => {
    expect(simulationConfigurations(undefined)).toEqual(['new-only', 'all']);
    expect(simulationConfigurations('new-only')).toEqual(['new-only']);
    expect(simulationConfigurations('all')).toEqual(['all']);
    expect(() => simulationConfigurations('unknown')).toThrow(
      '--configuration must be both, new-only, or all',
    );
  });
});

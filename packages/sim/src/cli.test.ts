import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

import {
  defaultRulesRoot,
  simulationConfigurations,
  simulationMode,
} from './cli.js';

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

  it('大量不変条件検証とAI互換性smokeを別々に選べる', () => {
    expect(simulationMode(undefined)).toBe('ai-smoke');
    expect(simulationMode('invariants')).toBe('invariants');
    expect(simulationMode('ai-smoke')).toBe('ai-smoke');
    expect(() => simulationMode('unknown')).toThrow(
      '--mode must be invariants or ai-smoke',
    );
  });
});

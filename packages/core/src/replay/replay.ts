import {
  ENGINE_CONTRACT_VERSION,
  SUPPORTED_CONTRACT_VERSIONS,
} from '../rules/contract.js';
import { NO_RULE_CHAIN_PORT, type RuleChainPort } from '../rules/chain.js';
import { reduceSet, startSet, type StartSetInput } from '../set/set-reducer.js';
import type {
  ReplayAction,
  ReplayInit,
  ReplayLogBoundary,
  SetAction,
  SetState,
} from '../set/types.js';

export interface ReplayExpectations {
  engineVersion?: string;
  contractVersion?: number;
  bundleHashes?: Readonly<Record<string, string>>;
}

export interface ReplayResult {
  state: SetState;
  warnings: string[];
  appliedActions: number;
}

export function createReplayInit(
  input: StartSetInput,
  engineVersion: string,
): ReplayInit {
  return {
    formatVersion: 1,
    engineVersion,
    contractVersion: ENGINE_CONTRACT_VERSION,
    setId: input.setId,
    setSeed: input.setSeed,
    config: structuredClone(input.config),
    members: structuredClone(input.members),
    ruleChain: structuredClone(input.ruleChain),
  };
}

export function createReplayAction(
  seq: number,
  action: SetAction,
): ReplayAction {
  if (!Number.isSafeInteger(seq) || seq < 0) {
    throw new Error('Replay action seq must be a non-negative safe integer');
  }
  return { seq, action: structuredClone(action) };
}

export async function appendAcceptedReplayAction(
  boundary: ReplayLogBoundary,
  seq: number,
  acceptedAction: SetAction | undefined,
): Promise<boolean> {
  if (!acceptedAction) {
    return false;
  }
  await boundary.append(createReplayAction(seq, acceptedAction));
  return true;
}

function warningsFor(
  init: ReplayInit,
  expectations: ReplayExpectations,
): string[] {
  const warnings: string[] = [];
  if (
    expectations.engineVersion !== undefined &&
    expectations.engineVersion !== init.engineVersion
  ) {
    warnings.push(
      `engineVersion mismatch: replay=${init.engineVersion}, current=${expectations.engineVersion}`,
    );
  }
  if (
    expectations.contractVersion !== undefined &&
    expectations.contractVersion !== init.contractVersion &&
    !(
      SUPPORTED_CONTRACT_VERSIONS.includes(
        init.contractVersion as (typeof SUPPORTED_CONTRACT_VERSIONS)[number],
      ) &&
      SUPPORTED_CONTRACT_VERSIONS.includes(
        expectations.contractVersion as (typeof SUPPORTED_CONTRACT_VERSIONS)[number],
      )
    )
  ) {
    warnings.push(
      `contractVersion mismatch: replay=${init.contractVersion}, current=${expectations.contractVersion}`,
    );
  }
  for (const entry of init.ruleChain) {
    const expected = expectations.bundleHashes?.[entry.ruleId];
    if (expected !== undefined && expected !== entry.bundleHash) {
      warnings.push(
        `bundleHash mismatch for ${entry.ruleId}: replay=${entry.bundleHash}, current=${expected}`,
      );
    }
  }
  return warnings;
}

export function replaySet(
  init: ReplayInit,
  actions: readonly ReplayAction[],
  port: RuleChainPort = NO_RULE_CHAIN_PORT,
  expectations: ReplayExpectations = {},
): ReplayResult {
  if (init.formatVersion !== 1) {
    throw new Error(`Unsupported replay format: ${String(init.formatVersion)}`);
  }
  const warnings = warningsFor(init, expectations);
  let state = startSet(
    {
      setId: init.setId,
      config: init.config,
      members: init.members,
      ruleChain: init.ruleChain,
      setSeed: init.setSeed,
    },
    port,
  );
  let expectedSeq = 0;
  for (const record of actions) {
    if (record.seq !== expectedSeq) {
      throw new Error(
        `Replay action sequence mismatch: expected ${expectedSeq}, got ${record.seq}`,
      );
    }
    const transition = reduceSet(state, record.action, port);
    if (transition.rejections.length > 0) {
      throw new Error(
        `Replay action ${record.seq} was rejected: ${JSON.stringify(
          transition.rejections,
        )}`,
      );
    }
    state = transition.state;
    expectedSeq += 1;
  }
  return { state, warnings, appliedActions: actions.length };
}

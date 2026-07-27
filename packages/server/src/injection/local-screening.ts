import type { ProposalRepository } from '../proposal/repository.js';
import {
  finalizeDetection,
  type DetectionResult,
  type LlmSuccessResult,
  type LlmVerdict,
  type StaticAnalysisResult,
} from './detector.js';
import type {
  InjectionRepository,
  StoredProposalSignals,
} from './repository.js';

export interface LocalL3Result {
  verdict: LlmVerdict;
  reason: string;
  evidence: string | null;
  model: string;
  latencyMs: number;
}

export interface PendingLocalScreening {
  proposal: {
    id: string;
    userId: string;
    kind: 'local' | 'original';
    prefectureCode: string | null;
    name: string;
    body: string;
  };
  signals: StoredProposalSignals;
}

export type RecordLocalVerdictResult =
  | { status: 'recorded'; checkId: number; result: DetectionResult }
  | { status: 'already_recorded'; checkId: number }
  | { status: 'not_found' }
  | { status: 'invalid'; error: string };

function parseL3Result(input: unknown): LocalL3Result | null {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return null;
  }
  const value = input as Record<string, unknown>;
  if (
    value.verdict !== 'clean' &&
    value.verdict !== 'suspicious' &&
    value.verdict !== 'injection'
  ) {
    return null;
  }
  if (
    typeof value.reason !== 'string' ||
    value.reason.trim().length === 0 ||
    value.reason.length > 1_000 ||
    (value.evidence !== null && typeof value.evidence !== 'string') ||
    typeof value.model !== 'string' ||
    value.model.trim().length === 0 ||
    typeof value.latencyMs !== 'number' ||
    !Number.isSafeInteger(value.latencyMs) ||
    value.latencyMs < 0
  ) {
    return null;
  }
  return {
    verdict: value.verdict,
    reason: value.reason.trim(),
    evidence:
      typeof value.evidence === 'string' && value.evidence.length > 0
        ? value.evidence
        : null,
    model: value.model.trim(),
    latencyMs: value.latencyMs,
  };
}

function staticAnalysis(signals: StoredProposalSignals): StaticAnalysisResult {
  return {
    detectorVersion: signals.detectorVersion,
    inputText: signals.inputText,
    normalizedText: signals.normalizedText,
    inputHash: signals.inputHash,
    layers: {
      layer0: signals.layer0,
      layer1: signals.layer1,
      layer2: signals.layer2,
    },
  };
}

export class LocalScreeningService {
  readonly #injection: InjectionRepository;
  readonly #proposals: ProposalRepository;
  readonly #now: () => number;

  constructor(
    injection: InjectionRepository,
    proposals: ProposalRepository,
    now: () => number = Date.now,
  ) {
    this.#injection = injection;
    this.#proposals = proposals;
    this.#now = now;
  }

  pending(limit = 100): PendingLocalScreening[] {
    return this.#proposals
      .screeningForJudgment()
      .flatMap((proposal) => {
        const signals = this.#injection.signalsForProposal(proposal.id);
        const verdict = this.#injection.checkForProposal(proposal.id);
        if (!signals || verdict) return [];
        return [
          {
            proposal: {
              id: proposal.id,
              userId: proposal.authorId,
              kind: proposal.kind,
              prefectureCode: proposal.prefectureCode,
              name: proposal.name,
              body: proposal.body,
            },
            signals,
          },
        ];
      })
      .slice(0, limit);
  }

  record(proposalId: string, input: unknown): RecordLocalVerdictResult {
    const proposal = this.#proposals.findById(proposalId);
    const signals = this.#injection.signalsForProposal(proposalId);
    if (!proposal || proposal.status !== 'screening' || !signals) {
      return { status: 'not_found' };
    }
    const parsed = parseL3Result(input);
    if (!parsed) {
      return { status: 'invalid', error: 'invalid_l3_result' };
    }
    const evidenceVerified =
      parsed.evidence !== null && signals.inputText.includes(parsed.evidence);
    const llm: LlmSuccessResult = { ...parsed, evidenceVerified };
    const result = finalizeDetection(staticAnalysis(signals), llm);
    const recorded = this.#injection.recordVerdict(
      result,
      proposal.authorId,
      proposalId,
      this.#now(),
    );
    return recorded.inserted
      ? { status: 'recorded', checkId: recorded.checkId, result }
      : { status: 'already_recorded', checkId: recorded.checkId };
  }
}

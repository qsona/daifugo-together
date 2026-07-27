import type { ProposalSignalRecorder } from '../proposal/submission.js';
import { InjectionStaticAnalyzer } from './detector.js';
import { InjectionRepository } from './repository.js';

/**
 * 受付時には L0〜L2 を同期計算して提案と同じ transaction に記録する。
 * 判定・遮断は行わず、L3 は開発マシンのローカル判定ツールが後続で実行する。
 */
export class InjectionSignalRecorder implements ProposalSignalRecorder {
  readonly #analyzer: InjectionStaticAnalyzer;
  readonly #repository: InjectionRepository;
  readonly #now: () => number;

  constructor(
    analyzer: InjectionStaticAnalyzer,
    repository: InjectionRepository,
    now: () => number = Date.now,
  ) {
    this.#analyzer = analyzer;
    this.#repository = repository;
    this.#now = now;
  }

  analyze(
    proposal: Parameters<ProposalSignalRecorder['analyze']>[0],
    authorId: string,
  ): ReturnType<ProposalSignalRecorder['analyze']> {
    const result = this.#analyzer.analyze(proposal);
    const now = this.#now();
    return {
      commit: (proposalId) => {
        this.#repository.recordSignals(result, authorId, proposalId, now);
      },
    };
  }
}

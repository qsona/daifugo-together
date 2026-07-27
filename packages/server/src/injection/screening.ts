import type { YellowCardInfo } from '@daifugo/core';

import type {
  ProposalInspection,
  ProposalScreeningGate,
} from '../proposal/submission.js';
import { InjectionDetector, InjectionUnavailableError } from './detector.js';
import { InjectionRepository } from './repository.js';

export class InjectionScreeningGate implements ProposalScreeningGate {
  readonly #detector: InjectionDetector;
  readonly #repository: InjectionRepository;
  readonly #now: () => number;

  constructor(
    detector: InjectionDetector,
    repository: InjectionRepository,
    now: () => number = Date.now,
  ) {
    this.#detector = detector;
    this.#repository = repository;
    this.#now = now;
  }

  async inspect(
    proposal: Parameters<ProposalScreeningGate['inspect']>[0],
    authorId: string,
  ): Promise<ProposalInspection> {
    let result;
    try {
      result = await this.#detector.detect(proposal, authorId);
    } catch (error) {
      if (error instanceof InjectionUnavailableError) {
        return { verdict: 'unavailable' };
      }
      throw error;
    }
    const now = this.#now();
    if (result.finalVerdict === 'pass') {
      return {
        verdict: 'pass',
        commit: (proposalId) => {
          this.#repository.commitCheck(result, authorId, proposalId, now);
        },
      };
    }
    return {
      verdict: 'blocked',
      commit: () => {
        const yellowCard = this.#repository.commitCheck(
          result,
          authorId,
          null,
          now,
        );
        if (!yellowCard) {
          throw new Error('Blocked inspection did not produce a response');
        }
        return yellowCard satisfies YellowCardInfo;
      },
    };
  }
}

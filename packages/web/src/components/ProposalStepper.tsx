import { Fragment } from 'react';

import { cx } from '../lib/cx';

import styles from './ProposalStepper.module.css';

export type StepState = 'pending' | 'done' | 'now' | 'released' | 'rejected';

export type ProposalStep = {
  label: string;
  state: StepState;
};

const stateClass: Record<StepState, string | undefined> = {
  pending: styles.pending,
  done: styles.done,
  now: styles.now,
  released: styles.released,
  rejected: styles.rejected,
};

/** 現在地として強調する状態。released / rejected は終点かつ現在地。 */
const CURRENT_STATES: readonly StepState[] = ['now', 'released', 'rejected'];

type ProposalStepperProps = {
  steps: readonly ProposalStep[];
  /** 見送り・開発できずのときの説明文。 */
  reason?: string;
};

export function ProposalStepper({ steps, reason }: ProposalStepperProps) {
  return (
    <div>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <Fragment key={step.label}>
            {index > 0 && (
              <span
                className={cx(
                  styles.line,
                  steps[index - 1]?.state === 'done' && styles.linePassed,
                )}
                aria-hidden="true"
              />
            )}
            <li
              className={cx(styles.step, stateClass[step.state])}
              aria-current={
                CURRENT_STATES.includes(step.state) ? 'step' : undefined
              }
            >
              {step.state === 'done' && (
                <>
                  <svg
                    className={styles.check}
                    width="10"
                    height="10"
                    viewBox="0 0 10 10"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M1.5 5.5 4 8l4.5-6" />
                  </svg>
                </>
              )}
              {step.state === 'now' && (
                <span className={styles.nowLabel}>いま</span>
              )}
              {step.label}
              {step.state === 'done' && <span className="sr-only">済み</span>}
            </li>
          </Fragment>
        ))}
      </ol>
      {reason && <p className={styles.reason}>見送りの理由: {reason}</p>}
    </div>
  );
}

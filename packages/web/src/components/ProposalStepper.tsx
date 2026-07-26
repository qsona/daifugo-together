import { Fragment } from 'react';

import { cx } from '../lib/cx';

import styles from './ProposalStepper.module.css';

export type StepState = 'pending' | 'done' | 'now' | 'released' | 'rejected';

export type ProposalStep = {
  label: string;
  state: StepState;
};

const stateClass: Record<StepState, string | undefined> = {
  pending: undefined,
  done: styles.done,
  now: styles.now,
  released: styles.released,
  rejected: styles.rejected,
};

type ProposalStepperProps = {
  steps: readonly ProposalStep[];
  /** 却下・実装失敗のときの説明文。 */
  reason?: string;
};

export function ProposalStepper({ steps, reason }: ProposalStepperProps) {
  return (
    <div>
      <ol className={styles.steps}>
        {steps.map((step, index) => (
          <Fragment key={step.label}>
            {index > 0 && <span className={styles.line} aria-hidden="true" />}
            <li className={cx(styles.step, stateClass[step.state])}>
              {step.label}
            </li>
          </Fragment>
        ))}
      </ol>
      {reason && <p className={styles.reason}>却下理由: {reason}</p>}
    </div>
  );
}

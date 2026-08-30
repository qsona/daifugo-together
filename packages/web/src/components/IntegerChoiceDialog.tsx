import { useId, useState } from 'react';

import { Button } from './Button';
import { Dialog, DialogBody } from './Dialog';
import styles from './IntegerChoiceDialog.module.css';

type IntegerChoiceDialogProps = {
  title: string;
  message: string;
  min: number;
  max: number;
  defaultValue: number;
  onConfirm(value: number): void;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export function IntegerChoiceDialog({
  title,
  message,
  min,
  max,
  defaultValue,
  onConfirm,
}: IntegerChoiceDialogProps) {
  const sliderId = useId();
  const [value, setValue] = useState(() => clamp(defaultValue, min, max));
  const ticks = Array.from(
    { length: max - min + 1 },
    (_, index) => min + index,
  );
  const changeBy = (amount: number) => {
    setValue((current) => clamp(current + amount, min, max));
  };

  return (
    <Dialog
      title={title}
      actions={
        <Button
          variant="primary"
          block
          onClick={() => {
            onConfirm(value);
          }}
        >
          {value}回目に決定
        </Button>
      }
    >
      <DialogBody>{message}</DialogBody>
      <output className={styles.value} htmlFor={sliderId} aria-live="polite">
        {value}回目
      </output>
      <div className={styles.controls}>
        <button
          type="button"
          className={styles.step}
          aria-label="1減らす"
          disabled={value <= min}
          onClick={() => {
            changeBy(-1);
          }}
        >
          −
        </button>
        <div className={styles.sliderColumn}>
          <label className={styles.visuallyHidden} htmlFor={sliderId}>
            パス回数
          </label>
          <input
            id={sliderId}
            className={styles.slider}
            type="range"
            min={min}
            max={max}
            step={1}
            value={value}
            aria-valuetext={`${String(value)}回目`}
            onChange={(event) => {
              setValue(Number(event.currentTarget.value));
            }}
          />
          <div className={styles.ticks} aria-hidden="true">
            {ticks.map((tick) => (
              <span key={tick} />
            ))}
          </div>
          <div className={styles.labels} aria-hidden="true">
            <span>{min}</span>
            <span>{Math.round((min + max) / 2)}</span>
            <span>{max}</span>
          </div>
        </div>
        <button
          type="button"
          className={styles.step}
          aria-label="1増やす"
          disabled={value >= max}
          onClick={() => {
            changeBy(1);
          }}
        >
          ＋
        </button>
      </div>
    </Dialog>
  );
}

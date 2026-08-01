import { clientPayloadSchemas, countCodePoints } from '@daifugo/core';

import { InputField } from './Field';
import { clampCodePoints } from '../lib/text';

export const DISPLAY_NAME_MAX_LENGTH = 10;

export type DisplayNameValidation =
  { ok: true; displayName: string } | { ok: false; error: string };

export function validateDisplayName(value: string): DisplayNameValidation {
  if (value.trim().length === 0) {
    return { ok: false, error: 'なまえを入れてください' };
  }
  // The shared schema trims first, so reject raw control characters before
  // parsing to keep tabs and line breaks from silently becoming valid names.
  if (
    [...value].some((character) => {
      const codePoint = character.codePointAt(0);
      return (
        codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)
      );
    })
  ) {
    return { ok: false, error: '使えない文字が入っています' };
  }
  const parsed = clientPayloadSchemas['user:rename'].safeParse({
    displayName: value,
  });
  return parsed.success
    ? { ok: true, displayName: parsed.data.displayName }
    : { ok: false, error: '使えない文字が入っています' };
}

export function NameField({
  value,
  onChange,
  disabled = false,
  label = 'なまえ',
  error,
  caption,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  label?: string;
  error?: string;
  caption?: string;
}) {
  const validation = validateDisplayName(value);
  const visibleError = error ?? (!validation.ok ? validation.error : undefined);
  return (
    <InputField
      label={label}
      labelSuffix={`${String(countCodePoints(value))} / ${String(DISPLAY_NAME_MAX_LENGTH)}`}
      value={value}
      aria-label={label}
      disabled={disabled}
      autoComplete="nickname"
      {...(caption ? { caption } : {})}
      {...(visibleError === undefined ? {} : { error: visibleError })}
      onChange={(event) => {
        onChange(clampCodePoints(event.target.value, DISPLAY_NAME_MAX_LENGTH));
      }}
    />
  );
}

const DAY_MS = 24 * 60 * 60 * 1_000;
const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

function validCalendarDate(raw: string): boolean {
  const [year, month, day] = raw.split('-').map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(Date.UTC(year, month - 1, day)).toISOString().startsWith(raw);
}

export function optionValue(
  arguments_: readonly string[],
  name: string,
): string | null {
  const index = arguments_.indexOf(name);
  const value = index >= 0 ? arguments_[index + 1] : undefined;
  return value && !value.startsWith('--') ? value : null;
}

export function nonNegativeIntegerOption(
  arguments_: readonly string[],
  name: string,
  fallback: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const raw = optionValue(arguments_, name);
  const value = raw === null ? fallback : Number(raw);
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum) {
    throw new Error(
      `${name} must be an integer between 0 and ${String(maximum)}`,
    );
  }
  return value;
}

export function parseSince(raw: string | null, now: number): number {
  if (raw === null) return now - 30 * DAY_MS;
  if (/^\d{4}-\d{2}-\d{2}$/u.test(raw)) {
    if (!validCalendarDate(raw)) {
      throw new Error('--since contains an invalid calendar date');
    }
    const [year, month, day] = raw.split('-').map(Number) as [
      number,
      number,
      number,
    ];
    const value = Date.UTC(year, month - 1, day) - JST_OFFSET_MS;
    return value;
  }
  if (!/^\d{4}-\d{2}-\d{2}T.+(?:Z|[+-]\d{2}:\d{2})$/u.test(raw)) {
    throw new Error(
      '--since datetime must include Z or an explicit UTC offset',
    );
  }
  if (!validCalendarDate(raw.slice(0, 10))) {
    throw new Error('--since contains an invalid calendar date');
  }
  const value = Date.parse(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error('--since must be a valid ISO date or datetime');
  }
  return value;
}

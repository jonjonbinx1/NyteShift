/**
 * Minimal cron expression & interval parser.
 *
 * Supports:
 * - Interval shorthand: "30s", "5m", "1h", "1d"
 * - Standard 5-field cron: "minute hour day-of-month month day-of-week"
 *   - `*`   any value
 *   - `N/n` every n starting at N  (or `* /n` — every n from 0)
 *   - `N`   exact value
 *   - `N-M` range
 *   - `N,M` list
 *
 * This is intentionally dependency-free; it covers the vast majority of
 * real-world schedules without pulling in node-cron or similar packages.
 */

// ── Interval helpers ───────────────────────────────────────────────────

const INTERVAL_RE = /^(\d+)\s*(s|sec|m|min|h|hr|hour|d|day)s?$/i;

const MULTIPLIERS: Record<string, number> = {
  s: 1_000,
  sec: 1_000,
  m: 60_000,
  min: 60_000,
  h: 3_600_000,
  hr: 3_600_000,
  hour: 3_600_000,
  d: 86_400_000,
  day: 86_400_000,
};

/**
 * Parse an interval shorthand like `"5m"` or `"1h"` and return the
 * equivalent duration in milliseconds, or `null` if the string isn't a
 * valid interval.
 */
export function parseInterval(expr: string): number | null {
  const m = expr.trim().match(INTERVAL_RE);
  if (!m) return null;
  const value = parseInt(m[1], 10);
  const unit = m[2].toLowerCase();
  const mult = MULTIPLIERS[unit];
  if (!mult || value <= 0) return null;
  return value * mult;
}

// ── Cron expression parser ─────────────────────────────────────────────

export interface CronFields {
  minute: Set<number>;
  hour: Set<number>;
  dayOfMonth: Set<number>;
  month: Set<number>;
  dayOfWeek: Set<number>;
}

function parseField(field: string, min: number, max: number): Set<number> {
  const values = new Set<number>();

  for (const part of field.split(",")) {
    const trimmed = part.trim();

    if (trimmed === "*") {
      for (let i = min; i <= max; i++) values.add(i);
    } else if (trimmed.includes("/")) {
      const [rangeStr, stepStr] = trimmed.split("/");
      const step = parseInt(stepStr, 10);
      if (isNaN(step) || step <= 0) throw new Error(`Invalid step in cron field: ${trimmed}`);
      const start = rangeStr === "*" ? min : parseInt(rangeStr, 10);
      if (isNaN(start)) throw new Error(`Invalid range start in cron field: ${trimmed}`);
      for (let i = start; i <= max; i += step) values.add(i);
    } else if (trimmed.includes("-")) {
      const [startStr, endStr] = trimmed.split("-");
      const start = parseInt(startStr, 10);
      const end = parseInt(endStr, 10);
      if (isNaN(start) || isNaN(end)) throw new Error(`Invalid range in cron field: ${trimmed}`);
      for (let i = start; i <= end; i++) values.add(i);
    } else {
      const val = parseInt(trimmed, 10);
      if (isNaN(val)) throw new Error(`Invalid value in cron field: ${trimmed}`);
      values.add(val);
    }
  }

  return values;
}

/** Parse a 5-field cron expression into sets of matching values. */
export function parseCron(expr: string): CronFields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression: expected 5 fields, got ${parts.length}`);
  }
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12),
    dayOfWeek: parseField(parts[4], 0, 6),
  };
}

/** Check whether a `Date` matches the given cron fields. */
export function matchesCron(fields: CronFields, date: Date): boolean {
  return (
    fields.minute.has(date.getMinutes()) &&
    fields.hour.has(date.getHours()) &&
    fields.dayOfMonth.has(date.getDate()) &&
    fields.month.has(date.getMonth() + 1) &&
    fields.dayOfWeek.has(date.getDay())
  );
}

/**
 * Determine whether a schedule string is a cron expression or an interval
 * shorthand.  Returns `"cron"` or `"interval"` — or throws if neither.
 */
export function classifySchedule(schedule: string): "cron" | "interval" {
  if (parseInterval(schedule) !== null) return "interval";
  // Try parsing as cron — will throw if invalid.
  parseCron(schedule);
  return "cron";
}

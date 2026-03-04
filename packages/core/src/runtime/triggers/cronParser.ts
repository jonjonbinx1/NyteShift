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

// ── Monthly matching ───────────────────────────────────────────────────

/**
 * Check whether `date` falls on the given day-of-month, hour, and minute.
 * Used by the engine for "monthly on day X" triggers.
 */
export function matchesMonthlyDay(
  day: number,
  hour: number,
  minute: number,
  date: Date,
): boolean {
  return (
    date.getDate() === day &&
    date.getHours() === hour &&
    date.getMinutes() === minute
  );
}

/**
 * Return the calendar date (1–31) of the nth occurrence of a weekday
 * pattern within `year`/`month`.
 *
 * @param year     Full 4-digit year.
 * @param month    0-indexed month (JS Date convention).
 * @param weekday  0–6 (Sun–Sat) | -1 (any day) | -2 (Mon–Fri) | -3 (Sat–Sun).
 * @param ordinal  "first" | "second" | "third" | "fourth" | "last".
 * @returns        The calendar day number, or `null` if it doesn't exist
 *                 (e.g. "fifth Monday" in a short month).
 */
function ordinalDayInMonth(
  year: number,
  month: number,
  weekday: number,
  ordinal: "first" | "second" | "third" | "fourth" | "last",
): number | null {
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  function isMatch(d: number): boolean {
    const dow = new Date(year, month, d).getDay();
    if (weekday >= 0)  return dow === weekday;
    if (weekday === -1) return true;                       // any day
    if (weekday === -2) return dow >= 1 && dow <= 5;      // Mon–Fri
    if (weekday === -3) return dow === 0 || dow === 6;    // Sat–Sun
    return false;
  }

  if (ordinal === "last") {
    for (let d = daysInMonth; d >= 1; d--) {
      if (isMatch(d)) return d;
    }
    return null;
  }

  const nth = { first: 1, second: 2, third: 3, fourth: 4 }[ordinal];
  let count = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (isMatch(d)) {
      count++;
      if (count === nth) return d;
    }
  }
  return null;
}

/**
 * Check whether `date` matches an ordinal-weekday monthly pattern
 * (e.g. "first Monday of each month at 09:00").
 *
 * @param ordinal  Ordinal position.
 * @param weekday  0–6 (Sun–Sat) | -1 (day) | -2 (weekday) | -3 (weekend day).
 * @param hour     0–23.
 * @param minute   0–59.
 * @param date     Moment to test.
 */
export function matchesMonthlyOrdinal(
  ordinal: "first" | "second" | "third" | "fourth" | "last",
  weekday: number,
  hour: number,
  minute: number,
  date: Date,
): boolean {
  const target = ordinalDayInMonth(
    date.getFullYear(),
    date.getMonth(),
    weekday,
    ordinal,
  );
  if (target === null) return false;
  return (
    date.getDate() === target &&
    date.getHours() === hour &&
    date.getMinutes() === minute
  );
}

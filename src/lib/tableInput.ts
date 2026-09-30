import { DEFAULT_TABLES, MAX_TABLES, MIN_TABLES } from "../engine/types";

function clamp(n: number): number {
  return Math.min(MAX_TABLES, Math.max(MIN_TABLES, n));
}

/** The typed table count, or null unless it is a whole number from 1 to 16. */
export function parseTableInput(text: string): number | null {
  const trimmed = text.trim();
  if (!/^\d{1,3}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= MIN_TABLES && n <= MAX_TABLES ? n : null;
}

/**
 * The value after pressing − (-1) or + (+1). A valid value moves by one and stops at 1 and 16;
 * an invalid value first snaps into range (e.g. "20" → 16, "0" → 1, "" → 4).
 */
export function stepTableInput(text: string, delta: 1 | -1): number {
  const n = parseTableInput(text);
  if (n !== null) return clamp(n + delta);
  const trimmed = text.trim();
  return /^\d+$/.test(trimmed) ? clamp(Number(trimmed)) : DEFAULT_TABLES;
}

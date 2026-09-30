// Save / load / clear the app state in localStorage (CLAUDE.md §4).
// Browser-only at call time; importing this module is safe during build and SSR.
// Never throws: problems come back as results the UI can show.

import { HISTORY_LIMIT, type AppState, type Tournament } from "../engine/types";

export const STORAGE_KEY = "knockout:v1";

export type LoadResult =
  /** Nothing saved yet. */
  | { status: "empty" }
  | { status: "ok"; state: AppState }
  /** Saved data exists but cannot be used: show "Could not restore the tournament". */
  | { status: "invalid"; reason: "json" | "version" | "shape" }
  /** No localStorage here (server render, disabled or blocked storage). */
  | { status: "unavailable" };

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    return null; // e.g. SecurityError when site data is blocked
  }
}

/** Save the whole app state as plain JSON, keeping only the last 50 snapshots. Returns false if it could not be written. */
export function saveState(state: AppState): boolean {
  const storage = getStorage();
  if (!storage) return false;
  const stored: AppState = {
    tournament: state.tournament,
    history: state.history.slice(-HISTORY_LIMIT),
    lang: state.lang,
  };
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false; // e.g. QuotaExceededError
  }
}

/** Load and validate the saved app state. Always returns fresh objects. */
export function loadState(): LoadResult {
  const storage = getStorage();
  if (!storage) return { status: "unavailable" };

  let raw: string | null;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { status: "unavailable" };
  }
  if (raw === null) return { status: "empty" };

  const data = parseJson(raw);
  if (data === INVALID_JSON) return { status: "invalid", reason: "json" };
  if (!isRecord(data)) return { status: "invalid", reason: "shape" };

  const { lang } = data;
  if (lang !== "ru" && lang !== "es") return { status: "invalid", reason: "shape" };

  const tournament = readTournament(data.tournament);
  if (tournament.error) return { status: "invalid", reason: tournament.error };

  if (!Array.isArray(data.history)) return { status: "invalid", reason: "shape" };
  const history = data.history.slice(-HISTORY_LIMIT);
  for (const snapshot of history) {
    if (typeof snapshot !== "string") return { status: "invalid", reason: "shape" };
    const parsed = parseJson(snapshot);
    if (parsed === INVALID_JSON) return { status: "invalid", reason: "json" };
    const restored = readTournament(parsed);
    if (restored.error) return { status: "invalid", reason: restored.error };
    if (restored.value === null) return { status: "invalid", reason: "shape" };
  }

  return { status: "ok", state: { tournament: tournament.value, history, lang } };
}

/** Remove the saved state. Returns false if storage is not available. */
export function clearState(): boolean {
  const storage = getStorage();
  if (!storage) return false;
  try {
    storage.removeItem(STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

// --- validation ---------------------------------------------------------------

const INVALID_JSON = Symbol("invalid json");

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return INVALID_JSON;
  }
}

type Read =
  | { error: null; value: Tournament | null }
  | { error: "version" | "shape"; value?: undefined };

function readTournament(value: unknown): Read {
  if (value === null) return { error: null, value: null };
  if (!isRecord(value)) return { error: "shape" };
  if (value.version !== 1) return { error: "version" };
  return isTournamentV1(value) ? { error: null, value } : { error: "shape" };
}

type JsonRecord = Record<string, unknown>;

function isRecord(v: unknown): v is JsonRecord {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function has(obj: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

function isInt(v: unknown, min: number, max: number): v is number {
  return Number.isInteger(v) && (v as number) >= min && (v as number) <= max;
}

/**
 * Structural check: correct types, and every id points to something that exists,
 * so the UI and engine can never crash on restored data. Game rules are the engine's job.
 */
function isTournamentV1(t: JsonRecord): t is Tournament {
  const { players, matches, tables, log, bracketSize, rounds } = t;
  if (typeof t.createdAt !== "string") return false;
  if (bracketSize !== 8 && bracketSize !== 16 && bracketSize !== 32) return false;
  if (rounds !== Math.log2(bracketSize)) return false;

  if (!isRecord(players)) return false;
  const playerIds = Object.keys(players);
  if (playerIds.length < 5 || playerIds.length > 30) return false;
  for (const id of playerIds) {
    const p = players[id];
    if (!isRecord(p) || p.id !== id || typeof p.name !== "string" || p.name === "" || typeof p.out !== "boolean") {
      return false;
    }
  }
  const isPlayerOrNull = (v: unknown) => v === null || (typeof v === "string" && has(players, v));

  if (!Array.isArray(tables) || !isInt(tables.length, 1, 16)) return false;
  if (!isRecord(matches) || Object.keys(matches).length !== bracketSize - 1) return false;
  for (const [id, m] of Object.entries(matches)) {
    if (!isRecord(m)) return false;
    if (!isInt(m.round, 1, rounds) || !isInt(m.position, 0, (bracketSize >> m.round) - 1)) return false;
    if (m.id !== id || id !== `${m.round}-${m.position}`) return false;
    if (m.number !== null && !isInt(m.number, 1, playerIds.length - 1)) return false;
    if (![m.a, m.b, m.winner, m.loser].every(isPlayerOrNull)) return false;
    if (typeof m.bye !== "boolean") return false;
    if (m.table !== null && (!isInt(m.table, 0, tables.length - 1) || tables[m.table] !== id)) return false;
    // A match on a table must be playable: the UI shows both names as buttons.
    if (m.table !== null && (m.a === null || m.b === null || m.a === m.b || m.winner !== null || m.loser !== null || m.bye)) {
      return false;
    }
    if (m.playedAt !== null && !isInt(m.playedAt, 0, 15)) return false;
  }
  for (let i = 0; i < tables.length; i++) {
    const id: unknown = tables[i];
    if (id === null) continue;
    if (typeof id !== "string" || !has(matches, id)) return false;
    if ((matches[id] as JsonRecord).table !== i) return false;
  }

  if (!isPlayerOrNull(t.champion)) return false;
  // Champion and final agree: the Champion screen shows "winner beat loser" from the final.
  const final = matches[`${rounds}-0`] as JsonRecord;
  if (t.champion === null) {
    if (final.winner !== null || final.loser !== null) return false;
  } else if (final.winner !== t.champion || final.loser === null) {
    return false;
  }
  if (!Array.isArray(log)) return false;
  for (const entry of log) {
    if (!isRecord(entry)) return false;
    if (typeof entry.winner !== "string" || !has(players, entry.winner)) return false;
    if (typeof entry.loser !== "string" || !has(players, entry.loser)) return false;
    if (!isInt(entry.table, 0, 15) || !isInt(entry.round, 1, rounds) || typeof entry.at !== "string") return false;
  }
  return true;
}

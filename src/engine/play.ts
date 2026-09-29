import {
  HISTORY_LIMIT,
  MAX_TABLES,
  MIN_TABLES,
  type Match,
  type RoundName,
  type Tournament,
} from "./types";

// Every exported function is pure: it never mutates its input and returns
// the same object when nothing changed (so the UI can skip saving / history).

function clone(t: Tournament): Tournament {
  return JSON.parse(JSON.stringify(t)) as Tournament;
}

function byOrder(x: Match, y: Match): number {
  return x.round - y.round || x.position - y.position;
}

/** Both players known, no winner, not on a table. */
export function isWaiting(m: Match): boolean {
  return !m.bye && m.a !== null && m.b !== null && m.winner === null && m.table === null;
}

/** Matches waiting for a table, in play order (round, then position). */
export function queue(t: Tournament): Match[] {
  return Object.values(t.matches).filter(isWaiting).sort(byOrder);
}

/**
 * Internal, MUTATES `t`: put the winner of a finished match into the next round
 * (slot a for even position, b for odd), or crown the champion after the final.
 */
export function advanceWinnerInPlace(t: Tournament, m: Match): void {
  if (m.winner === null) return;
  if (m.round === t.rounds) {
    t.champion = m.winner;
    return;
  }
  const next = t.matches[`${m.round + 1}-${Math.floor(m.position / 2)}`];
  if (m.position % 2 === 0) next.a = m.winner;
  else next.b = m.winner;
}

/** Internal, MUTATES `t`: fill free tables in order with the first waiting matches. */
export function assignTablesInPlace(t: Tournament): void {
  const waiting = queue(t);
  for (let i = 0; i < t.tables.length && waiting.length > 0; i++) {
    if (t.tables[i] !== null) continue;
    const m = t.matches[waiting.shift()!.id];
    m.table = i;
    t.tables[i] = m.id;
  }
}

/** For every free table (Table 1, 2, 3…) take the first waiting match. */
export function assignTables(t: Tournament): Tournament {
  const hasFree = t.tables.some((id) => id === null);
  if (!hasFree || queue(t).length === 0) return t;
  const next = clone(t);
  assignTablesInPlace(next);
  return next;
}

/**
 * The organizer taps the winner of a match that is on a table.
 * Anything else (finished match, waiting match, unknown ids) is ignored: double-tap safe.
 */
export function pickWinner(
  t: Tournament,
  matchId: string,
  playerId: string,
  now: string = new Date().toISOString(),
): Tournament {
  const current = t.matches[matchId];
  if (!current || current.bye || current.winner !== null || current.table === null) return t;
  if (current.a === null || current.b === null) return t;
  if (playerId !== current.a && playerId !== current.b) return t;

  const next = clone(t);
  const m = next.matches[matchId];
  const table = m.table!;
  const loser = playerId === m.a ? m.b! : m.a!;

  m.winner = playerId;
  m.loser = loser;
  m.table = null;
  m.playedAt = table;
  next.players[loser].out = true;
  next.tables[table] = null;
  next.log.push({ winner: playerId, loser, table, round: m.round, at: now });

  advanceWinnerInPlace(next, m);
  assignTablesInPlace(next);
  return next;
}

export type SetTableCountResult =
  | { ok: true; tournament: Tournament }
  | { ok: false; reason: "outOfRange" }
  /** `tables` are the 0-based indices of the busy tables that would be removed. */
  | { ok: false; reason: "tableBusy"; tables: number[] };

/**
 * Increasing adds free tables and fills them. Decreasing removes tables from the end,
 * but only if all of them are free; otherwise nothing changes.
 */
export function setTableCount(t: Tournament, count: number): SetTableCountResult {
  if (!Number.isInteger(count) || count < MIN_TABLES || count > MAX_TABLES) {
    return { ok: false, reason: "outOfRange" };
  }
  const current = t.tables.length;
  if (count === current) return { ok: true, tournament: t };

  if (count < current) {
    const busy: number[] = [];
    for (let i = count; i < current; i++) if (t.tables[i] !== null) busy.push(i);
    if (busy.length > 0) return { ok: false, reason: "tableBusy", tables: busy };
    const next = clone(t);
    next.tables = next.tables.slice(0, count);
    return { ok: true, tournament: next };
  }

  const next = clone(t);
  while (next.tables.length < count) next.tables.push(null);
  assignTablesInPlace(next);
  return { ok: true, tournament: next };
}

/** Last round "Final", then "Semifinal", "Quarterfinal", earlier "Round 1", "Round 2"… */
export function roundName(rounds: number, round: number): RoundName {
  const fromEnd = rounds - round;
  if (fromEnd === 0) return { key: "final" };
  if (fromEnd === 1) return { key: "semifinal" };
  if (fromEnd === 2) return { key: "quarterfinal" };
  return { key: "round", round };
}

/** Tables that received a match in `after` which they did not hold in `before` (for the "NEW" highlight). */
export function newlyAssignedTables(before: Tournament | null, after: Tournament): number[] {
  const result: number[] = [];
  after.tables.forEach((id, i) => {
    if (id !== null && before?.tables[i] !== id) result.push(i);
  });
  return result;
}

/** Numbers for the header: "5 of 11 matches played · 8 players left". */
export function progress(t: Tournament): { played: number; total: number; playersLeft: number } {
  const players = Object.values(t.players);
  return {
    played: t.log.length,
    total: players.length - 1,
    playersLeft: players.filter((p) => !p.out).length,
  };
}

// --- Undo -----------------------------------------------------------------

export function snapshot(t: Tournament): string {
  return JSON.stringify(t);
}

/** Remember `t` before an action; keeps only the last `limit` snapshots. */
export function pushHistory(history: string[], t: Tournament, limit: number = HISTORY_LIMIT): string[] {
  return [...history, snapshot(t)].slice(-limit);
}

/** Restore the previous snapshot, or null if there is nothing to undo. */
export function undo(history: string[]): { tournament: Tournament; history: string[] } | null {
  if (history.length === 0) return null;
  return {
    tournament: JSON.parse(history[history.length - 1]) as Tournament,
    history: history.slice(0, -1),
  };
}

// Pure data model of a knockout tournament (CLAUDE.md §4).
// Everything here is plain JSON so it can be stored and restored as-is.

export const MIN_PLAYERS = 5;
export const MAX_PLAYERS = 30;
export const MIN_TABLES = 1;
export const MAX_TABLES = 16;
export const DEFAULT_TABLES = 4;
export const HISTORY_LIMIT = 50;

/** Random number generator returning a float in [0, 1). Injected, never Math.random inside the engine. */
export type Rng = () => number;

export type Player = { id: string; name: string; out: boolean };

export type Match = {
  id: string; // `${round}-${position}`
  round: number; // 1 = first round
  position: number; // index inside the round
  number: number | null; // 1..N-1 for real matches, null for BYE
  a: string | null; // player id
  b: string | null;
  winner: string | null;
  loser: string | null;
  bye: boolean;
  table: number | null; // index of the table while playing (0-based)
  playedAt: number | null; // table index where it was played (history)
};

export type LogEntry = {
  winner: string; // player id
  loser: string; // player id
  table: number; // table index (0-based), same as Match.playedAt
  round: number;
  at: string; // ISO timestamp
};

export type Tournament = {
  version: 1;
  createdAt: string;
  players: Record<string, Player>;
  matches: Record<string, Match>;
  rounds: number;
  bracketSize: 8 | 16 | 32;
  tables: (string | null)[]; // matchId per table, null = free
  champion: string | null;
  log: LogEntry[]; // oldest first
};

export type AppState = {
  tournament: Tournament | null;
  history: string[]; // last 50 snapshots for Undo, oldest first
  lang: "ru" | "es";
};

/** Language-neutral round name; the UI translates it. */
export type RoundName =
  | { key: "final" }
  | { key: "semifinal" }
  | { key: "quarterfinal" }
  | { key: "round"; round: number };

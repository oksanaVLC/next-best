import { nameKey } from "./parsePlayers";
import { advanceWinnerInPlace, assignTablesInPlace } from "./play";
import {
  MAX_PLAYERS,
  MAX_TABLES,
  MIN_PLAYERS,
  MIN_TABLES,
  type Match,
  type Player,
  type Rng,
  type Tournament,
} from "./types";

/** Next power of two, minimum 8: 5–8 → 8, 9–16 → 16, 17–30 → 32. */
export function bracketSizeFor(playerCount: number): 8 | 16 | 32 {
  if (playerCount <= 8) return 8;
  if (playerCount <= 16) return 16;
  return 32;
}

/**
 * Standard seed order, generated recursively: 8 → [1, 8, 4, 5, 2, 7, 3, 6].
 * Neighbours form round-1 pairs, and each pair sums to size + 1.
 */
export function seedOrder(size: number): number[] {
  let order = [1];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    order = order.flatMap((seed) => [seed, sum - seed]);
  }
  return order;
}

/** Fisher–Yates shuffle with an injected rng. Returns a new array. */
export function shuffle<T>(items: readonly T[], rng: Rng): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(rng() * (i + 1)));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function validate(names: readonly string[], tableCount: number): void {
  if (names.length < MIN_PLAYERS || names.length > MAX_PLAYERS) {
    throw new RangeError(`Need ${MIN_PLAYERS}–${MAX_PLAYERS} players, got ${names.length}`);
  }
  const seen = new Set<string>();
  for (const name of names) {
    if (name.trim() === "") throw new RangeError("Player names must not be empty");
    const key = nameKey(name);
    if (seen.has(key)) throw new RangeError(`Duplicate player name: ${name}`);
    seen.add(key);
  }
  if (!Number.isInteger(tableCount) || tableCount < MIN_TABLES || tableCount > MAX_TABLES) {
    throw new RangeError(`Need ${MIN_TABLES}–${MAX_TABLES} tables, got ${tableCount}`);
  }
}

/**
 * Build a new tournament from clean names (use parsePlayers first) and start it:
 * BYEs are completed, real matches numbered 1..N-1, and waiting matches put on tables.
 */
export function createTournament(
  names: readonly string[],
  tableCount: number,
  rng: Rng,
  now: string = new Date().toISOString(),
): Tournament {
  validate(names, tableCount);

  const size = bracketSizeFor(names.length);
  const rounds = Math.log2(size);

  const players: Record<string, Player> = {};
  const ids = names.map((name, i) => {
    const id = `p${i + 1}`;
    players[id] = { id, name, out: false };
    return id;
  });

  const matches: Record<string, Match> = {};
  for (let round = 1; round <= rounds; round++) {
    for (let position = 0; position < size >> round; position++) {
      const id = `${round}-${position}`;
      matches[id] = {
        id,
        round,
        position,
        number: null,
        a: null,
        b: null,
        winner: null,
        loser: null,
        bye: false,
        table: null,
        playedAt: null,
      };
    }
  }

  const t: Tournament = {
    version: 1,
    createdAt: now,
    players,
    matches,
    rounds,
    bracketSize: size,
    tables: Array.from({ length: tableCount }, () => null),
    champion: null,
    log: [],
  };

  // Seed k gets the k-th shuffled player; seeds above N are BYEs.
  // A BYE seed is > N > size/2, so its opponent (size + 1 - seed) is always a real player.
  const seeded = shuffle(ids, rng);
  const playerForSeed = (seed: number) => (seed <= seeded.length ? seeded[seed - 1] : null);
  const order = seedOrder(size);

  for (let position = 0; position < size / 2; position++) {
    const m = matches[`1-${position}`];
    m.a = playerForSeed(order[2 * position]);
    m.b = playerForSeed(order[2 * position + 1]);
    if (m.a === null || m.b === null) {
      m.bye = true;
      m.winner = m.a ?? m.b;
      advanceWinnerInPlace(t, m);
    }
  }

  let number = 1;
  for (let round = 1; round <= rounds; round++) {
    for (let position = 0; position < size >> round; position++) {
      const m = matches[`${round}-${position}`];
      if (!m.bye) m.number = number++;
    }
  }

  assignTablesInPlace(t);
  return t;
}

import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bracketSizeFor, createTournament, seedOrder, shuffle } from "./bracket";
import { parsePlayers } from "./parsePlayers";
import {
  newlyAssignedTables,
  pickWinner,
  progress,
  pushHistory,
  queue,
  roundName,
  setTableCount,
  undo,
} from "./play";
import type { Match, Rng, Tournament } from "./types";

// --- helpers ----------------------------------------------------------------

const NOW = "2026-01-01T12:00:00.000Z";
const TABLE_COUNTS = [1, 2, 4, 7, 16];
const SEEDS = [1, 2, 3, 42, 2026];
/** There is no maximum: every N up to 33, then samples around each bracket boundary up to 257. */
const PLAYER_COUNTS = [
  ...Array.from({ length: 29 }, (_, i) => i + 5),
  ...[63, 64, 65, 100, 127, 128, 129, 250, 255, 256, 257],
];
/** A full simulation costs ~N² with checks after every step, so large N use fewer combinations. */
const tableCountsFor = (n: number) => (n <= 65 ? TABLE_COUNTS : [1, 7, 16]);
const seedsFor = (n: number) => (n <= 65 ? SEEDS : SEEDS.slice(0, 1));

/** Deterministic PRNG (mulberry32). */
function seededRng(seed: number): Rng {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNames(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `Player ${i + 1}`);
}

function start(n: number, tables: number, seed = 1): Tournament {
  return createTournament(makeNames(n), tables, seededRng(seed), NOW);
}

/** Freeze deeply so any mutation by the engine throws (ES modules are strict). */
function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

function matchOn(t: Tournament, table: number): Match {
  const id = t.tables[table];
  if (id === null) throw new Error(`Table ${table} is free`);
  return t.matches[id];
}

function busyTables(t: Tournament): number[] {
  return t.tables.flatMap((id, i) => (id === null ? [] : [i]));
}

/** Every rule from CLAUDE.md §5 "Invariants", plus structural consistency. Returns violations. */
function invariantErrors(t: Tournament): string[] {
  const errors: string[] = [];
  const playerIds = Object.keys(t.players);
  const n = playerIds.length;
  const matches = Object.values(t.matches);
  const size = t.bracketSize;

  // Structure
  if (size !== bracketSizeFor(n)) errors.push(`bracketSize ${size} for ${n} players`);
  if (t.rounds !== Math.log2(size)) errors.push(`rounds ${t.rounds} for size ${size}`);
  if (matches.length !== size - 1) errors.push(`${matches.length} matches for size ${size}`);
  if (t.tables.length < 1 || t.tables.length > 16) errors.push(`${t.tables.length} tables`);
  for (const m of matches) {
    if (m.id !== `${m.round}-${m.position}`) errors.push(`bad id ${m.id}`);
  }

  // Every player in round 1 exactly once (or as a BYE recipient)
  const round1 = matches.filter((m) => m.round === 1);
  const seen = new Map<string, number>();
  for (const m of round1) {
    for (const p of [m.a, m.b]) if (p !== null) seen.set(p, (seen.get(p) ?? 0) + 1);
  }
  for (const id of playerIds) {
    if (seen.get(id) !== 1) errors.push(`player ${id} appears ${seen.get(id) ?? 0}x in round 1`);
  }
  if (seen.size !== n) errors.push("unknown player ids in round 1");

  // BYEs: only in round 1, never BYE vs BYE, completed at creation, not numbered
  const byes = matches.filter((m) => m.bye);
  if (byes.length !== size - n) errors.push(`${byes.length} BYEs, expected ${size - n}`);
  for (const m of round1) {
    if (m.a === null && m.b === null) errors.push(`BYE vs BYE in ${m.id}`);
    if (m.bye !== (m.a === null || m.b === null)) errors.push(`bye flag wrong in ${m.id}`);
  }
  for (const m of byes) {
    if (m.round !== 1) errors.push(`BYE outside round 1: ${m.id}`);
    if (m.winner !== (m.a ?? m.b)) errors.push(`BYE ${m.id} not completed`);
    if (m.number !== null || m.table !== null || m.loser !== null) errors.push(`BYE ${m.id} has number/table/loser`);
  }

  // Real matches: N-1, numbered 1..N-1 by round, then position
  const real = matches.filter((m) => !m.bye).sort((x, y) => x.round - y.round || x.position - y.position);
  if (real.length !== n - 1) errors.push(`${real.length} real matches, expected ${n - 1}`);
  real.forEach((m, i) => {
    if (m.number !== i + 1) errors.push(`match ${m.id} numbered ${m.number}, expected ${i + 1}`);
  });

  // No self-matches
  for (const m of matches) if (m.a !== null && m.a === m.b) errors.push(`self-match ${m.id}`);

  // Tables: at most one match each, consistent both ways, a player never on two tables
  const onTables = new Set<string>();
  const playersOnTables = new Set<string>();
  t.tables.forEach((id, i) => {
    if (id === null) return;
    const m = t.matches[id];
    if (!m) return void errors.push(`table ${i} holds unknown match ${id}`);
    if (onTables.has(id)) errors.push(`match ${id} on two tables`);
    onTables.add(id);
    if (m.table !== i) errors.push(`match ${id} on table ${i} but says ${m.table}`);
    if (m.winner !== null || m.a === null || m.b === null) errors.push(`table ${i} holds non-playable ${id}`);
    for (const p of [m.a, m.b]) {
      if (p === null) continue;
      if (playersOnTables.has(p)) errors.push(`player ${p} on two tables`);
      playersOnTables.add(p);
    }
  });
  for (const m of matches) {
    if (m.table !== null && t.tables[m.table] !== m.id) errors.push(`match ${m.id} claims table ${m.table}`);
  }

  // No eliminated player in an unfinished match
  for (const m of matches) {
    if (m.winner !== null) continue;
    for (const p of [m.a, m.b]) if (p !== null && t.players[p].out) errors.push(`eliminated ${p} in ${m.id}`);
  }

  // If a table is free and a match is waiting, it is assigned
  if (t.tables.includes(null) && queue(t).length > 0) errors.push("free table while a match is waiting");

  // Results are consistent with the log and with the next round
  const finished = real.filter((m) => m.winner !== null);
  if (t.log.length !== finished.length) errors.push(`log ${t.log.length} vs ${finished.length} results`);
  const outCount = Object.values(t.players).filter((p) => p.out).length;
  if (outCount !== t.log.length) errors.push(`${outCount} out vs ${t.log.length} results`);
  for (const m of finished) {
    const other = m.winner === m.a ? m.b : m.a;
    if (m.winner !== m.a && m.winner !== m.b) errors.push(`winner of ${m.id} did not play`);
    if (m.loser !== other) errors.push(`loser of ${m.id} wrong`);
    if (m.loser !== null && !t.players[m.loser].out) errors.push(`loser ${m.loser} not out`);
    if (m.playedAt === null || m.table !== null) errors.push(`finished ${m.id} table state wrong`);
  }
  // Each log entry describes exactly one finished match: same players, round and table
  const logged = new Set<string>();
  const byResult = new Map(finished.map((m) => [`${m.winner}>${m.loser}`, m])); // keeps large N fast
  t.log.forEach((entry, i) => {
    const m = byResult.get(`${entry.winner}>${entry.loser}`);
    if (!m) return void errors.push(`log[${i}] matches no result`);
    if (logged.has(m.id)) errors.push(`match ${m.id} logged twice`);
    logged.add(m.id);
    if (entry.round !== m.round) errors.push(`log[${i}] round ${entry.round}, match ${m.id} is round ${m.round}`);
    if (entry.table !== m.playedAt) errors.push(`log[${i}] table ${entry.table}, match ${m.id} played at ${m.playedAt}`);
  });
  for (const m of matches) {
    if (m.winner === null || m.round === t.rounds) continue;
    const next = t.matches[`${m.round + 1}-${Math.floor(m.position / 2)}`];
    const slot = m.position % 2 === 0 ? next.a : next.b;
    if (slot !== m.winner) errors.push(`winner of ${m.id} not advanced`);
  }

  // Champion
  const final = t.matches[`${t.rounds}-0`];
  if (t.champion !== final.winner) errors.push("champion does not match the final");
  if (t.champion !== null) {
    if (t.log.length !== n - 1) errors.push(`finished with ${t.log.length} results`);
    if (t.players[t.champion].out) errors.push("champion is out");
    if (outCount !== n - 1) errors.push("not everyone else is out");
    if (busyTables(t).length > 0 || queue(t).length > 0) errors.push("finished but matches remain");
  }
  return errors;
}

function expectValid(t: Tournament): void {
  expect(invariantErrors(t)).toEqual([]);
}

function expectFinished(t: Tournament, n: number): void {
  expectValid(t);
  expect(t.champion).not.toBeNull();
  expect(t.log).toHaveLength(n - 1);
  const alive = Object.values(t.players).filter((p) => !p.out);
  expect(alive.map((p) => p.id)).toEqual([t.champion]);
}

/**
 * After a valid pick: exactly one entry was appended, earlier entries are untouched, and the new
 * entry names the match that was on that table *before* the pick (its players, round and table).
 */
function expectLoggedPick(before: Tournament, after: Tournament, at = NOW): void {
  expect(after.log).toHaveLength(before.log.length + 1);
  expect(after.log.slice(0, -1)).toEqual(before.log);
  const entry = after.log[after.log.length - 1];
  const m = matchOn(before, entry.table);
  expect([m.a, m.b].sort()).toEqual([entry.winner, entry.loser].sort());
  expect(entry).toEqual({ winner: after.matches[m.id].winner, loser: after.matches[m.id].loser, table: entry.table, round: m.round, at });
  expect(after.matches[m.id].playedAt).toBe(entry.table);
}

/** Pick a random busy table and a random winner there. */
function randomPick(t: Tournament, rng: Rng): Tournament {
  const busy = busyTables(t);
  if (busy.length === 0) throw new Error("No busy table but no champion either");
  const m = matchOn(t, busy[Math.floor(rng() * busy.length)]);
  const winner = rng() < 0.5 ? m.a! : m.b!;
  return pickWinner(t, m.id, winner, NOW);
}

// --- parsePlayers -----------------------------------------------------------

describe("parsePlayers", () => {
  it("splits on new lines and commas", () => {
    expect(parsePlayers("Anna, Maria\nSofia,Peter\r\nIván").names).toEqual([
      "Anna",
      "Maria",
      "Sofia",
      "Peter",
      "Iván",
    ]);
  });

  it("drops blank lines and empty segments", () => {
    expect(parsePlayers("\n\nAnna\n\n,, ,\nMaria\n   \n\t\n").names).toEqual(["Anna", "Maria"]);
  });

  it("trims and collapses inner whitespace", () => {
    expect(parsePlayers("  Anna   Maria  \n\tJohn\t Smith \n Lucía  García").names).toEqual([
      "Anna Maria",
      "John Smith",
      "Lucía García",
    ]);
  });

  it("removes duplicates case-insensitively, keeps the first spelling, reports the count", () => {
    const r = parsePlayers("Anna\nanna\nMaria\nANNA\nmaria\nSofia");
    expect(r.names).toEqual(["Anna", "Maria", "Sofia"]);
    expect(r.duplicatesRemoved).toBe(3);
  });

  it("treats names that differ only in spacing as duplicates", () => {
    const r = parsePlayers("Anna  Maria\n anna maria ");
    expect(r.names).toEqual(["Anna Maria"]);
    expect(r.duplicatesRemoved).toBe(1);
  });

  it("handles Cyrillic case-insensitively", () => {
    const r = parsePlayers("Анна\nАННА\nЁлка\nёлка\nОльга");
    expect(r.names).toEqual(["Анна", "Ёлка", "Ольга"]);
    expect(r.duplicatesRemoved).toBe(2);
  });

  it("handles empty input", () => {
    expect(parsePlayers("")).toEqual({ names: [], duplicatesRemoved: 0, status: "tooFew" });
    expect(parsePlayers(" \n , \n")).toEqual({ names: [], duplicatesRemoved: 0, status: "tooFew" });
  });

  it("needs at least 5 names and has no maximum", () => {
    expect(parsePlayers(makeNames(4).join("\n")).status).toBe("tooFew");
    expect(parsePlayers(makeNames(5).join("\n")).status).toBe("ok");
    expect(parsePlayers(makeNames(30).join(",")).status).toBe("ok");
    expect(parsePlayers(makeNames(31).join("\n")).status).toBe("ok");
    const many = parsePlayers(makeNames(1000).join("\n"));
    expect(many.status).toBe("ok");
    expect(many.names).toHaveLength(1000);
  });

  it("counts only unique names for validation", () => {
    const r = parsePlayers("A\nB\nC\nD\na");
    expect(r.names).toHaveLength(4);
    expect(r.status).toBe("tooFew");
  });
});

// --- bracket ----------------------------------------------------------------

describe("bracket", () => {
  it("bracket size is the next power of two, minimum 8", () => {
    for (let n = 5; n <= 2050; n++) {
      const size = bracketSizeFor(n);
      expect(Number.isInteger(Math.log2(size))).toBe(true);
      expect(size).toBeGreaterThanOrEqual(Math.max(8, n));
      if (size > 8) expect(size / 2).toBeLessThan(n);
    }
    const boundaries: [number, number][] = [
      [5, 8], [8, 8], [9, 16], [16, 16], [17, 32], [30, 32], [32, 32], [33, 64], [64, 64], [65, 128],
      [100, 128], [128, 128], [129, 256], [250, 256], [256, 256], [257, 512], [1000, 1024],
    ];
    for (const [n, size] of boundaries) expect(bracketSizeFor(n), `${n} players`).toBe(size);
  });

  it("generates the standard seed order", () => {
    expect(seedOrder(8)).toEqual([1, 8, 4, 5, 2, 7, 3, 6]);
    expect(seedOrder(16)).toEqual([1, 16, 8, 9, 4, 13, 5, 12, 2, 15, 7, 10, 3, 14, 6, 11]);
    for (const size of [8, 16, 32, 64, 128, 256, 512, 1024]) {
      const order = seedOrder(size);
      expect([...order].sort((x, y) => x - y)).toEqual(Array.from({ length: size }, (_, i) => i + 1));
      for (let i = 0; i < size; i += 2) expect(order[i] + order[i + 1]).toBe(size + 1);
    }
  });

  it("shuffles deterministically with the injected rng, without mutating the input", () => {
    const input = deepFreeze(["a", "b", "c", "d", "e", "f"]);
    const first = shuffle(input, seededRng(7));
    expect(shuffle(input, seededRng(7))).toEqual(first);
    expect([...first].sort()).toEqual([...input]);
    expect(shuffle(input, () => 0.9999999999)).toHaveLength(6);
  });

  it("gives BYEs to the top seeds, never BYE vs BYE, and moves BYE players to round 2", () => {
    for (const n of PLAYER_COUNTS) {
      const t = start(n, 4, n);
      const size = bracketSizeFor(n);
      const seeded = shuffle(Object.keys(t.players), seededRng(n));
      const topSeeds = new Set(seeded.slice(0, size - n));
      const byes = Object.values(t.matches).filter((m) => m.bye);
      expect(byes).toHaveLength(size - n);
      for (const m of byes) {
        expect(m.a === null && m.b === null).toBe(false);
        expect(topSeeds.has(m.winner!)).toBe(true);
        const next = t.matches[`2-${Math.floor(m.position / 2)}`];
        expect(m.position % 2 === 0 ? next.a : next.b).toBe(m.winner);
      }
      expectValid(t);
    }
  });

  it("has N-1 real matches numbered 1..N-1 by round, then position", () => {
    for (const n of PLAYER_COUNTS) {
      const t = start(n, 2);
      const real = Object.values(t.matches)
        .filter((m) => !m.bye)
        .sort((x, y) => x.round - y.round || x.position - y.position);
      expect(real.map((m) => m.number)).toEqual(Array.from({ length: n - 1 }, (_, i) => i + 1));
      expect(Object.values(t.matches).filter((m) => m.bye).every((m) => m.number === null)).toBe(true);
    }
  });

  it("creates a fresh started tournament", () => {
    const t = start(12, 4);
    expect(t.version).toBe(1);
    expect(t.createdAt).toBe(NOW);
    expect(t.bracketSize).toBe(16);
    expect(t.rounds).toBe(4);
    expect(t.champion).toBeNull();
    expect(t.log).toEqual([]);
    expect(Object.values(t.players).map((p) => p.name)).toEqual(makeNames(12));
    expect(Object.values(t.players).every((p) => !p.out)).toBe(true);
    expect(JSON.parse(JSON.stringify(t))).toEqual(t); // plain JSON
  });

  it("creates large tournaments with no player maximum", () => {
    for (const [n, size, rounds] of [
      [31, 32, 5],
      [64, 64, 6],
      [100, 128, 7],
      [250, 256, 8],
      [1000, 1024, 10],
    ]) {
      const t = start(n, 16);
      expect(t.bracketSize).toBe(size);
      expect(t.rounds).toBe(rounds);
      expect(Object.keys(t.matches)).toHaveLength(size - 1);
      expect(busyTables(t).length).toBe(Math.min(16, busyTables(t).length + queue(t).length));
      expectValid(t);
    }
  });

  it("129 players: 127 BYEs leave one real round-1 match, and round 2 starts at once", () => {
    const t = start(129, 16);
    expect(Object.values(t.matches).filter((m) => m.round === 1 && !m.bye)).toHaveLength(1);
    expect(busyTables(t).filter((i) => matchOn(t, i).round === 2)).toHaveLength(15);
    expectValid(t);
  });

  it("is deterministic for a seed and varies across seeds", () => {
    expect(start(20, 4, 5)).toEqual(start(20, 4, 5));
    const layouts = new Set(SEEDS.map((s) => JSON.stringify(start(20, 4, s).matches)));
    expect(layouts.size).toBeGreaterThan(1);
  });

  it("rejects invalid setups", () => {
    const rng = seededRng(1);
    expect(() => createTournament(makeNames(4), 4, rng)).toThrow(RangeError);
    expect(() => createTournament(["A", "B", "C", "D", "a"], 4, rng)).toThrow(RangeError);
    expect(() => createTournament(["A", "B", "C", "D", " "], 4, rng)).toThrow(RangeError);
    for (const tables of [0, 17, 2.5, Number.NaN]) {
      expect(() => createTournament(makeNames(8), tables, rng)).toThrow(RangeError);
    }
  });
});

// --- tables & picking winners -----------------------------------------------

describe("assigning tables", () => {
  it("fills tables in order with matches in round, then position order on Start", () => {
    const t = start(8, 4);
    expect(t.tables).toEqual(["1-0", "1-1", "1-2", "1-3"]);
    const two = start(8, 2);
    expect(two.tables).toEqual(["1-0", "1-1"]);
    expect(queue(two).map((m) => m.id)).toEqual(["1-2", "1-3"]);
  });

  it("leaves extra tables free when nothing is waiting", () => {
    const t = start(8, 7);
    expect(t.tables).toEqual(["1-0", "1-1", "1-2", "1-3", null, null, null]);
    expectValid(t);
  });

  it("starts a match as soon as both players are known, without waiting for the round", () => {
    // 5 players: seeds 2 and 3 both get BYEs, so their round-2 match is ready at once.
    const t = start(5, 16);
    expect(matchOn(t, 0).round).toBe(1);
    expect(matchOn(t, 1).id).toBe("2-1");

    // 16 players: after the first two round-1 matches, 2-0 is played while round 1 continues.
    let u = start(16, 16);
    u = pickWinner(u, "1-0", u.matches["1-0"].a!, NOW);
    u = pickWinner(u, "1-1", u.matches["1-1"].b!, NOW);
    expect(u.tables[0]).toBe("2-0");
    expect(busyTables(u).filter((i) => matchOn(u, i).round === 1)).toHaveLength(6);
    expectValid(u);
  });

  it("prefers earlier rounds and the lowest free table", () => {
    let t = start(16, 2);
    t = pickWinner(t, "1-0", t.matches["1-0"].a!, NOW);
    expect(t.tables).toEqual(["1-2", "1-1"]);
    t = pickWinner(t, "1-1", t.matches["1-1"].a!, NOW);
    // 2-0 is now waiting, but round 1 goes first.
    expect(t.tables).toEqual(["1-2", "1-3"]);
    expect(queue(t)[0].id).toBe("1-4");

    const u = setTableCount(start(8, 4), 6);
    if (!u.ok) throw new Error("expected ok");
    let v = u.tournament;
    v = pickWinner(v, "1-2", v.matches["1-2"].a!, NOW);
    expect(v.tables[2]).toBeNull();
    v = pickWinner(v, "1-3", v.matches["1-3"].a!, NOW);
    expect(v.tables).toEqual(["1-0", "1-1", "2-1", null, null, null]);
    expectValid(v);
  });
});

describe("pickWinner", () => {
  it("records the result, frees the table, advances the winner and refills the table", () => {
    const t = deepFreeze(start(8, 2));
    const m = t.matches["1-0"];
    const next = pickWinner(t, "1-0", m.b!, NOW);

    const done = next.matches["1-0"];
    expect(done.winner).toBe(m.b);
    expect(done.loser).toBe(m.a);
    expect(done.table).toBeNull();
    expect(done.playedAt).toBe(0);
    expect(next.players[m.a!].out).toBe(true);
    expect(next.players[m.b!].out).toBe(false);
    expect(next.matches["2-0"].a).toBe(m.b); // even position -> slot a
    expect(next.log).toEqual([{ winner: m.b, loser: m.a, table: 0, round: 1, at: NOW }]);
    expect(next.tables).toEqual(["1-2", "1-1"]);
    expectValid(next);

    const after = pickWinner(next, "1-1", next.matches["1-1"].a!, NOW);
    expect(after.matches["2-0"].b).toBe(next.matches["1-1"].a); // odd position -> slot b
  });

  it("does not mutate its input", () => {
    const t = start(12, 4);
    const before = JSON.stringify(t);
    deepFreeze(t);
    const m = matchOn(t, 0);
    expect(() => pickWinner(t, m.id, m.a!, NOW)).not.toThrow();
    expect(JSON.stringify(t)).toBe(before);
  });

  it("sets the champion after the final", () => {
    let t = start(5, 1);
    while (!t.champion) t = pickWinner(t, t.tables[0]!, matchOn(t, 0).a!, NOW);
    expectFinished(t, 5);
    expect(t.log.at(-1)!.round).toBe(t.rounds);
  });

  describe("double tap", () => {
    it("ignores the same tap twice", () => {
      const t = start(12, 4);
      const m = matchOn(t, 0);
      const once = pickWinner(t, m.id, m.a!, NOW);
      const twice = pickWinner(once, m.id, m.a!, NOW);
      expect(twice).toBe(once);
      expect(twice.log).toHaveLength(1);
    });

    it("ignores a tap on the other player of a finished match", () => {
      const t = start(12, 4);
      const m = matchOn(t, 0);
      const once = pickWinner(t, m.id, m.a!, NOW);
      expect(pickWinner(once, m.id, m.b!, NOW)).toBe(once);
    });

    it("ignores a stale tap after the table already got its next match", () => {
      const t = start(16, 2);
      const m = matchOn(t, 0);
      const once = pickWinner(t, m.id, m.a!, NOW);
      expect(once.tables[0]).not.toBe(m.id);
      expect(pickWinner(once, m.id, m.a!, NOW)).toBe(once);
      expect(pickWinner(once, m.id, m.b!, NOW)).toBe(once);
    });

    it("ignores matches that are not on a table, BYEs, unknown ids and outsiders", () => {
      const t = start(12, 1);
      const waiting = queue(t)[0];
      expect(pickWinner(t, waiting.id, waiting.a!, NOW)).toBe(t);
      const bye = Object.values(t.matches).find((m) => m.bye)!;
      expect(pickWinner(t, bye.id, bye.winner!, NOW)).toBe(t);
      expect(pickWinner(t, "9-9", "p1", NOW)).toBe(t);
      const onTable = matchOn(t, 0);
      const outsider = Object.keys(t.players).find((p) => p !== onTable.a && p !== onTable.b)!;
      expect(pickWinner(t, onTable.id, outsider, NOW)).toBe(t);
      expect(pickWinner(t, "2-0", "p1", NOW)).toBe(t); // not ready yet
    });

    it("ignores taps after the champion is decided", () => {
      let t = start(6, 2);
      const rng = seededRng(3);
      while (!t.champion) t = randomPick(t, rng);
      const final = t.matches[`${t.rounds}-0`];
      expect(pickWinner(t, final.id, final.loser!, NOW)).toBe(t);
    });
  });
});

describe("match log", () => {
  const at = (i: number) => `2026-01-01T12:00:0${i}.000Z`;

  it("records the table, round, winner and loser of a match on a later table", () => {
    const t = start(8, 4);
    const m = t.matches["1-2"];
    expect(m.table).toBe(2);
    const next = pickWinner(t, "1-2", m.b!, at(1));
    expect(next.log).toEqual([{ winner: m.b, loser: m.a, table: 2, round: 1, at: at(1) }]);
    expect(next.matches["1-2"].playedAt).toBe(2);
  });

  it("appends exactly one correct entry per pick through every round, keeping earlier entries", () => {
    // [match, winning slot, table it is on, round] — hand-traced for 8 players on 4 tables:
    // 2-1 lands on table 2, 2-0 on table 0 (lowest free), the final on table 0.
    const steps: [string, "a" | "b", number, number][] = [
      ["1-2", "a", 2, 1],
      ["1-3", "b", 3, 1],
      ["1-0", "a", 0, 1],
      ["1-1", "b", 1, 1],
      ["2-1", "a", 2, 2],
      ["2-0", "b", 0, 2],
      ["3-0", "a", 0, 3],
    ];
    let t = start(8, 4);
    const expected: Tournament["log"] = [];
    steps.forEach(([id, side, table, round], i) => {
      const m = t.matches[id];
      expect(m.table).toBe(table);
      const winner = side === "a" ? m.a! : m.b!;
      const loser = side === "a" ? m.b! : m.a!;
      t = pickWinner(t, id, winner, at(i));
      expected.push({ winner, loser, table, round, at: at(i) });
      expect(t.log).toEqual(expected);
      expectValid(t);
    });
    expect(t.champion).toBe(expected[expected.length - 1].winner);
  });

  it("does not change after invalid or repeated picks", () => {
    const t = start(12, 1);
    const m = matchOn(t, 0);
    const after = pickWinner(t, m.id, m.a!, at(1));
    expect(after.log).toHaveLength(1);
    const log = JSON.stringify(after.log);

    const current = matchOn(after, 0);
    const waiting = queue(after)[0];
    const bye = Object.values(after.matches).find((x) => x.bye)!;
    const attempts: [string, string][] = [
      [m.id, m.a!], // same tap again
      [m.id, m.b!], // other player of the finished match
      [current.id, m.b!], // eliminated player who is not in this match
      [waiting.id, waiting.a!], // match not on a table
      [bye.id, bye.winner!], // BYE
      ["9-9", m.a!], // unknown match
    ];
    for (const [matchId, playerId] of attempts) {
      const result = pickWinner(after, matchId, playerId, at(2));
      expect(result).toBe(after);
      expect(JSON.stringify(result.log)).toBe(log);
    }

    const next = pickWinner(after, current.id, current.b!, at(3));
    expect(next.log).toHaveLength(2);
    expect(next.log[0]).toEqual(after.log[0]);
    expect(next.log[1]).toEqual({ winner: current.b, loser: current.a, table: 0, round: 1, at: at(3) });
  });
});

describe("setTableCount", () => {
  it("adding tables assigns waiting matches immediately", () => {
    const t = start(16, 2);
    const r = setTableCount(t, 5);
    if (!r.ok) throw new Error("expected ok");
    expect(r.tournament.tables).toEqual(["1-0", "1-1", "1-2", "1-3", "1-4"]);
    expect(newlyAssignedTables(t, r.tournament)).toEqual([2, 3, 4]);
    expectValid(r.tournament);
  });

  it("added tables stay free until a match is waiting, then get filled", () => {
    const r = setTableCount(start(8, 4), 5);
    if (!r.ok) throw new Error("expected ok");
    let t = r.tournament;
    expect(t.tables[4]).toBeNull();
    t = pickWinner(t, "1-0", t.matches["1-0"].a!, NOW);
    t = pickWinner(t, "1-1", t.matches["1-1"].a!, NOW);
    expect(t.tables).toEqual(["2-0", null, "1-2", "1-3", null]);
    expectValid(t);
  });

  it("removes free tables from the end", () => {
    const t = start(8, 7);
    const r = setTableCount(t, 4);
    if (!r.ok) throw new Error("expected ok");
    expect(r.tournament.tables).toEqual(["1-0", "1-1", "1-2", "1-3"]);
    expectValid(r.tournament);
  });

  it('refuses to remove a busy table ("Table 7 is still playing")', () => {
    const t = deepFreeze(start(30, 7));
    expect(setTableCount(t, 6)).toEqual({ ok: false, reason: "tableBusy", tables: [6] });
    expect(setTableCount(t, 3)).toEqual({ ok: false, reason: "tableBusy", tables: [3, 4, 5, 6] });
  });

  it("refuses when any removed table is busy, even if the last one is free", () => {
    let t = start(8, 4);
    t = pickWinner(t, "1-3", t.matches["1-3"].a!, NOW); // table 3 becomes free
    expect(t.tables[3]).toBeNull();
    expect(setTableCount(t, 2)).toEqual({ ok: false, reason: "tableBusy", tables: [2] });
    const r = setTableCount(t, 3);
    expect(r.ok && r.tournament.tables).toEqual(["1-0", "1-1", "1-2"]);
  });

  it("rejects counts outside 1–16 and returns the same tournament for no change", () => {
    const t = start(8, 4);
    for (const n of [0, -1, 17, 1.5, Number.NaN]) {
      expect(setTableCount(t, n)).toEqual({ ok: false, reason: "outOfRange" });
    }
    expect(setTableCount(t, 4)).toEqual({ ok: true, tournament: t });
    const r = setTableCount(t, 4);
    expect(r.ok && r.tournament).toBe(t);
  });

  it("changing tables mid-game keeps everything valid until the champion", () => {
    let t = start(20, 3, 9);
    const rng = seededRng(9);
    const plan = [5, 1, 16, 2, 7, 4, 1, 12];
    let step = 0;
    while (!t.champion) {
      const target = plan[step++ % plan.length];
      const r = setTableCount(t, target);
      if (r.ok) t = r.tournament;
      else if (r.reason === "tableBusy") {
        expect(r.tables.length).toBeGreaterThan(0);
        for (const i of r.tables) expect(t.tables[i]).not.toBeNull();
      }
      expectValid(t);
      t = randomPick(t, rng);
      expectValid(t);
    }
    expectFinished(t, 20);
  });
});

describe("round names", () => {
  it("names rounds from the end", () => {
    expect([1, 2, 3].map((r) => roundName(3, r))).toEqual([
      { key: "quarterfinal" },
      { key: "semifinal" },
      { key: "final" },
    ]);
    expect(roundName(4, 1)).toEqual({ key: "round", round: 1 });
    expect(roundName(4, 2)).toEqual({ key: "quarterfinal" });
    expect([1, 2, 3].map((r) => roundName(5, r))).toEqual([
      { key: "round", round: 1 },
      { key: "round", round: 2 },
      { key: "quarterfinal" },
    ]);
  });
});

describe("progress and highlights", () => {
  it("counts played matches and players left", () => {
    const t = start(12, 4);
    expect(progress(t)).toEqual({ played: 0, total: 11, playersLeft: 12 });
    const m = matchOn(t, 0);
    expect(progress(pickWinner(t, m.id, m.a!, NOW))).toEqual({ played: 1, total: 11, playersLeft: 11 });
  });

  it("reports which tables received a new match", () => {
    const t = start(16, 2);
    expect(newlyAssignedTables(null, t)).toEqual([0, 1]);
    const next = pickWinner(t, "1-1", t.matches["1-1"].a!, NOW);
    expect(newlyAssignedTables(t, next)).toEqual([1]);
    const full = start(8, 7);
    expect(newlyAssignedTables(full, pickWinner(full, "1-0", full.matches["1-0"].a!, NOW))).toEqual([]);
  });
});

// --- Undo -------------------------------------------------------------------

describe("undo", () => {
  it("returns null when there is nothing to undo", () => {
    expect(undo([])).toBeNull();
  });

  it("fixes a wrong tap", () => {
    const t = start(12, 4);
    const m = matchOn(t, 0);
    const wrong = pickWinner(t, m.id, m.a!, NOW);
    const history = pushHistory([], t);
    const restored = undo(history)!;
    expect(restored.tournament).toEqual(t);
    expect(restored.history).toEqual([]);
    const right = pickWinner(restored.tournament, m.id, m.b!, NOW);
    expect(right.matches[m.id].winner).toBe(m.b);
    expect(right.players[m.a!].out).toBe(true);
    expect(right.players[m.b!].out).toBe(false);
    expect(wrong.players[m.b!].out).toBe(true); // the wrong state object itself is untouched
    expectValid(right);
  });

  it("keeps only the last 50 snapshots", () => {
    let t = start(30, 1);
    let history: string[] = [];
    const rng = seededRng(4);
    const states: Tournament[] = [];
    for (let i = 0; i < 29; i++) {
      states.push(t);
      history = pushHistory(history, t);
      t = randomPick(t, rng);
    }
    for (let i = 0; i < 30; i++) {
      const r = setTableCount(t, (i % 16) + 1);
      if (!r.ok) continue;
      states.push(t);
      history = pushHistory(history, t);
      t = r.tournament;
    }
    expect(states.length).toBeGreaterThan(50);
    expect(history).toHaveLength(50);
    expect(JSON.parse(history[0])).toEqual(states[states.length - 50]);
  });

  it("undoes table changes and winners back to the start, including from the champion", () => {
    for (const [n, tables] of [
      [12, 7],
      [5, 1],
      [30, 16],
      [17, 2],
    ]) {
      const initial = start(n, tables, n);
      const rng = seededRng(n);
      let t = initial;
      let history: string[] = [];
      const states: Tournament[] = [];
      let actions = 0;
      while (!t.champion) {
        const r = actions % 5 === 2 ? setTableCount(t, 1 + Math.floor(rng() * 16)) : null;
        const next = r ? (r.ok ? r.tournament : t) : randomPick(t, rng);
        actions++;
        if (next === t) continue;
        states.push(t);
        history = pushHistory(history, t);
        t = next;
      }
      expectFinished(t, n);
      expect(history.length).toBeLessThanOrEqual(50);
      const reachable = states.slice(-history.length);

      while (history.length > 0) {
        const r = undo(history)!;
        history = r.history;
        t = r.tournament;
        expect(t).toEqual(reachable[history.length]);
        expectValid(t);
      }
      if (states.length <= 50) expect(t).toEqual(initial);
      expect(undo(history)).toBeNull();
    }
  });
});

// --- full simulations -------------------------------------------------------

const cases = PLAYER_COUNTS.flatMap((n) => tableCountsFor(n).map((tables) => ({ n, tables })));

describe("full tournaments", () => {
  it.each(cases)("$n players on $tables tables always end with one champion", ({ n, tables }) => {
    for (const seed of seedsFor(n)) {
      let t = deepFreeze(createTournament(makeNames(n), tables, seededRng(seed), NOW));
      expectValid(t);
      const rng = seededRng(seed * 7919 + n);
      let steps = 0;
      while (!t.champion) {
        const next = deepFreeze(randomPick(t, rng));
        expect(next).not.toBe(t);
        expectLoggedPick(t, next);
        expectValid(next);
        t = next;
        if (++steps > n) throw new Error("too many steps");
      }
      expect(steps).toBe(n - 1);
      expectFinished(t, n);
    }
  });

  it("500 players on 7 tables end with one champion", () => {
    const n = 500;
    let t = createTournament(makeNames(n), 7, seededRng(n), NOW);
    expectValid(t);
    const rng = seededRng(n + 1);
    let steps = 0;
    while (!t.champion) {
      t = randomPick(t, rng);
      steps++;
      expectValid(t);
      if (steps > n) throw new Error("too many steps");
    }
    expect(steps).toBe(n - 1);
    expectFinished(t, n);
  });
});

describe("chaos: random winners, table changes and undo", () => {
  it.each(PLAYER_COUNTS)("%i players", (n) => {
    for (const seed of seedsFor(n)) {
      const rng = seededRng(seed * 31 + n);
      let t = deepFreeze(createTournament(makeNames(n), 1 + Math.floor(rng() * 16), rng, NOW));
      let history: string[] = [];
      let guard = 0;
      while (!t.champion) {
        if (++guard > 5000 + 100 * n) throw new Error("did not finish");
        const roll = rng();
        let next = t;
        if (roll < 0.2) {
          const target = t.tables.length + Math.floor(rng() * 7) - 3;
          const r = setTableCount(t, target);
          if (r.ok) next = r.tournament;
          else if (r.reason === "outOfRange") expect(target < 1 || target > 16).toBe(true);
          else for (const i of r.tables) expect(t.tables[i]).not.toBeNull();
        } else if (roll < 0.3) {
          const r = undo(history);
          if (r) {
            t = deepFreeze(r.tournament);
            history = r.history;
            expectValid(t);
            continue;
          }
        } else {
          next = randomPick(t, rng);
          expectLoggedPick(t, next);
        }
        if (next !== t) {
          history = pushHistory(history, t);
          t = deepFreeze(next);
        }
        expectValid(t);
      }
      expectFinished(t, n);
    }
  });
});

// --- purity guard -----------------------------------------------------------

describe("engine purity", () => {
  it("engine sources use no React, storage, browser globals or Math.random", () => {
    const dir = new URL("./", import.meta.url);
    const files = readdirSync(dir).filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    expect(files.sort()).toEqual(["bracket.ts", "parsePlayers.ts", "play.ts", "types.ts"]);
    for (const file of files) {
      const src = readFileSync(new URL(file, dir), "utf8").replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "");
      expect(src, file).not.toMatch(/Math\.random|localStorage|sessionStorage|\bwindow\b|\bdocument\b|from ["']react/);
    }
  });
});

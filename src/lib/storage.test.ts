import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTournament } from "../engine/bracket";
import { pickWinner, pushHistory, setTableCount } from "../engine/play";
import type { AppState, Tournament } from "../engine/types";
import { clearState, loadState, saveState, STORAGE_KEY } from "./storage";

// --- helpers ----------------------------------------------------------------

const NOW = "2026-01-01T12:00:00.000Z";

/** In-memory localStorage; can be told to throw like a blocked or full browser storage. */
class MemoryStorage {
  data = new Map<string, string>();
  failGet = false;
  failSet = false;
  get length() {
    return this.data.size;
  }
  clear() {
    this.data.clear();
  }
  getItem(key: string) {
    if (this.failGet) throw new Error("SecurityError");
    return this.data.get(key) ?? null;
  }
  key(i: number) {
    return [...this.data.keys()][i] ?? null;
  }
  removeItem(key: string) {
    this.data.delete(key);
  }
  setItem(key: string, value: string) {
    if (this.failSet) throw new Error("QuotaExceededError");
    this.data.set(key, String(value));
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

function seededRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

function names(n: number) {
  return Array.from({ length: n }, (_, i) => `Player ${i + 1}`);
}

/** A mid-game state built with the real engine: some winners, a table change, Undo history. */
function midGameState(picks = 4): AppState {
  let t = createTournament(names(12), 3, seededRng(1), NOW);
  let history: string[] = [];
  for (let i = 0; i < picks; i++) {
    const m = t.matches[t.tables.find((id) => id !== null)!];
    history = pushHistory(history, t);
    t = pickWinner(t, m.id, m.a!, NOW);
  }
  const r = setTableCount(t, 5);
  if (!r.ok) throw new Error("expected ok");
  history = pushHistory(history, t);
  return { tournament: r.tournament, history, lang: "ru" };
}

function finishedTournament(): Tournament {
  let t = createTournament(names(5), 2, seededRng(2), NOW);
  while (!t.champion) {
    const m = t.matches[t.tables.find((id) => id !== null)!];
    t = pickWinner(t, m.id, m.b!, NOW);
  }
  return t;
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

/** Store raw JSON built from a valid state after applying a change to it. */
function storeCorrupted(change: (data: { tournament: Record<string, unknown>; history: unknown[]; lang: unknown }) => void) {
  const data = JSON.parse(JSON.stringify(midGameState()));
  change(data);
  storage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// --- tests --------------------------------------------------------------------

describe("save and load", () => {
  it("returns an equivalent state after saving", () => {
    const state = midGameState();
    expect(saveState(state)).toBe(true);
    expect(loadState()).toEqual({ status: "ok", state });
  });

  it("stores plain JSON under the knockout:v1 key", () => {
    const state = midGameState();
    saveState(state);
    expect([...storage.data.keys()]).toEqual(["knockout:v1"]);
    expect(JSON.parse(storage.data.get("knockout:v1")!)).toEqual(state);
  });

  it("round-trips a finished tournament and a state without a tournament", () => {
    const finished: AppState = { tournament: finishedTournament(), history: [], lang: "es" };
    saveState(finished);
    expect(loadState()).toEqual({ status: "ok", state: finished });

    const none: AppState = { tournament: null, history: [], lang: "es" };
    saveState(none);
    expect(loadState()).toEqual({ status: "ok", state: none });
  });

  it("loads a valid version 1 state written directly to storage", () => {
    const state = midGameState(6);
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    const result = loadState();
    expect(result.status).toBe("ok");
    if (result.status !== "ok") return;
    expect(result.state.tournament?.version).toBe(1);
    expect(result.state).toEqual(state);
  });

  it("the loaded tournament keeps working with the engine", () => {
    const state = midGameState();
    saveState(state);
    const result = loadState();
    if (result.status !== "ok" || !result.state.tournament) throw new Error("expected a tournament");
    const t = result.state.tournament;
    const m = t.matches[t.tables.find((id) => id !== null)!];
    const next = pickWinner(t, m.id, m.b!, NOW);
    expect(next.log).toHaveLength(t.log.length + 1);
  });

  it("returns empty when nothing is saved", () => {
    expect(loadState()).toEqual({ status: "empty" });
  });
});

describe("clear", () => {
  it("removes the saved state", () => {
    saveState(midGameState());
    storage.setItem("other-app", "keep me");
    expect(clearState()).toBe(true);
    expect(loadState()).toEqual({ status: "empty" });
    expect(storage.data.get("other-app")).toBe("keep me");
  });

  it("is safe when nothing is saved", () => {
    expect(clearState()).toBe(true);
    expect(loadState()).toEqual({ status: "empty" });
  });
});

describe("no mutation", () => {
  it("saving does not mutate or keep a reference to the state", () => {
    const state = midGameState();
    const before = JSON.stringify(state);
    deepFreeze(state);
    expect(() => saveState(state)).not.toThrow();
    expect(JSON.stringify(state)).toBe(before);
  });

  it("does not trim the caller's history array", () => {
    const state = midGameState();
    const t = state.tournament!;
    const history = Array.from({ length: 60 }, () => JSON.stringify(t));
    saveState({ ...state, history });
    expect(history).toHaveLength(60);
  });

  it("every load returns fresh objects that do not affect storage", () => {
    saveState(midGameState());
    const first = loadState();
    const second = loadState();
    if (first.status !== "ok" || second.status !== "ok") throw new Error("expected ok");
    expect(first.state).not.toBe(second.state);
    expect(first.state.tournament).not.toBe(second.state.tournament);
    first.state.tournament!.players.p1.name = "Changed";
    first.state.history.length = 0;
    expect(loadState()).toEqual(second);
  });
});

describe("history limit", () => {
  function stateWithHistory(count: number): AppState {
    let t = createTournament(names(30), 1, seededRng(3), NOW);
    let history: string[] = [];
    for (let i = 0; i < count; i++) {
      history = [...history, JSON.stringify(t)]; // not pushHistory: build more than 50 on purpose
      const r = setTableCount(t, (i % 16) + 1);
      if (r.ok && r.tournament !== t) t = r.tournament;
      else if (!t.champion) {
        const m = t.matches[t.tables.find((id) => id !== null)!];
        t = pickWinner(t, m.id, m.a!, NOW);
      }
    }
    return { tournament: t, history, lang: "ru" };
  }

  it("saves only the last 50 snapshots", () => {
    const state = stateWithHistory(60);
    saveState(state);
    const stored = JSON.parse(storage.data.get(STORAGE_KEY)!);
    expect(stored.history).toHaveLength(50);
    expect(stored.history).toEqual(state.history.slice(-50));
  });

  it("loads only the last 50 snapshots from older or edited data", () => {
    const state = stateWithHistory(60);
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    const result = loadState();
    if (result.status !== "ok") throw new Error("expected ok");
    expect(result.state.history).toEqual(state.history.slice(-50));
  });

  it("keeps a history of exactly 50 unchanged", () => {
    const state = stateWithHistory(50);
    saveState(state);
    expect(loadState()).toEqual({ status: "ok", state });
  });
});

describe("corrupt or unknown data", () => {
  it("rejects malformed JSON", () => {
    for (const raw of ["{not json", "", "{", "undefined", '{"tournament":']) {
      storage.setItem(STORAGE_KEY, raw);
      expect(loadState()).toEqual({ status: "invalid", reason: "json" });
    }
  });

  it("rejects JSON that is not an app state", () => {
    for (const raw of ["null", "[]", "42", '"text"', "{}", '{"tournament":null,"history":[]}']) {
      storage.setItem(STORAGE_KEY, raw);
      expect(loadState()).toEqual({ status: "invalid", reason: "shape" });
    }
  });

  it("rejects an unknown tournament version", () => {
    for (const version of [2, 0, "1", null, undefined]) {
      storeCorrupted((d) => {
        d.tournament.version = version;
      });
      expect(loadState()).toEqual({ status: "invalid", reason: "version" });
    }
  });

  it("rejects an unknown version inside an Undo snapshot", () => {
    storeCorrupted((d) => {
      const snap = JSON.parse(d.history[0] as string);
      snap.version = 2;
      d.history[0] = JSON.stringify(snap);
    });
    expect(loadState()).toEqual({ status: "invalid", reason: "version" });
  });

  it("rejects a malformed Undo snapshot", () => {
    storeCorrupted((d) => {
      d.history[1] = "{broken";
    });
    expect(loadState()).toEqual({ status: "invalid", reason: "json" });
    storeCorrupted((d) => {
      d.history[1] = 42;
    });
    expect(loadState()).toEqual({ status: "invalid", reason: "shape" });
    storeCorrupted((d) => {
      d.history[1] = "null";
    });
    expect(loadState()).toEqual({ status: "invalid", reason: "shape" });
  });

  it("rejects broken structure without crashing", () => {
    const breakages: ((d: { tournament: Record<string, unknown>; history: unknown[]; lang: unknown }) => void)[] = [
      (d) => void (d.lang = "en"),
      (d) => void (d.history = "nope" as unknown as unknown[]),
      (d) => void delete d.tournament.players,
      (d) => void delete d.tournament.createdAt,
      (d) => void (d.tournament.bracketSize = 12),
      (d) => void (d.tournament.rounds = 3),
      (d) => void (d.tournament.tables = []),
      (d) => void (d.tournament.tables = new Array(17).fill(null)),
      (d) => void (d.tournament.champion = "p99"),
      (d) => void (d.tournament.log = {}),
      (d) => {
        const tables = d.tournament.tables as (string | null)[];
        tables[0] = "9-9"; // unknown match on a table
      },
      (d) => {
        const matches = d.tournament.matches as Record<string, Record<string, unknown>>;
        const tables = d.tournament.tables as (string | null)[];
        matches[tables[1]!].table = 0; // match and table disagree
      },
      (d) => {
        const tables = d.tournament.tables as (string | null)[];
        const busy = tables.findIndex((id) => id !== null);
        tables[busy] = null; // the match still claims this table, but the table says free
      },
      (d) => {
        const matches = d.tournament.matches as Record<string, Record<string, unknown>>;
        matches["1-0"].a = "p99"; // unknown player
      },
      (d) => {
        const matches = d.tournament.matches as Record<string, Record<string, unknown>>;
        delete matches["2-0"]; // missing match
      },
      (d) => {
        const players = d.tournament.players as Record<string, Record<string, unknown>>;
        players.p1.out = "no";
      },
      (d) => {
        const log = d.tournament.log as Record<string, unknown>[];
        log[0].winner = "__proto__";
      },
    ];
    for (const breakIt of breakages) {
      storeCorrupted(breakIt);
      expect(() => loadState()).not.toThrow();
      expect(loadState()).toEqual({ status: "invalid", reason: "shape" });
    }
  });
});

type RawMatch = Record<string, unknown>;

/** Store `t` (as raw JSON) after changing its tournament and one of its matches. */
function storeTournamentWith(t: Tournament, matchId: (t: Tournament) => string, change: (m: RawMatch, raw: Record<string, unknown>) => void) {
  const raw = JSON.parse(JSON.stringify(t));
  change(raw.matches[matchId(t)], raw);
  storage.setItem(STORAGE_KEY, JSON.stringify({ tournament: raw, history: [], lang: "es" }));
}

const busyMatch = (t: Tournament) => t.tables.find((id) => id !== null)!;
const finalMatch = (t: Tournament) => `${t.rounds}-0`;
const INVALID = { status: "invalid", reason: "shape" };

describe("a match on a table must be playable", () => {
  it("rejects a busy match with a missing player", () => {
    storeTournamentWith(midGameState().tournament!, busyMatch, (m) => void (m.b = null));
    expect(loadState()).toEqual(INVALID);
    storeTournamentWith(midGameState().tournament!, busyMatch, (m) => void (m.a = null));
    expect(loadState()).toEqual(INVALID);
  });

  it("rejects a busy self-match", () => {
    storeTournamentWith(midGameState().tournament!, busyMatch, (m) => void (m.b = m.a));
    expect(loadState()).toEqual(INVALID);
  });

  it("rejects a busy match that already has a winner", () => {
    storeTournamentWith(midGameState().tournament!, busyMatch, (m) => void (m.winner = m.a));
    expect(loadState()).toEqual(INVALID);
  });

  it("rejects a busy match that has a loser or is a BYE", () => {
    storeTournamentWith(midGameState().tournament!, busyMatch, (m) => void (m.loser = m.b));
    expect(loadState()).toEqual(INVALID);
    storeTournamentWith(midGameState().tournament!, busyMatch, (m) => void (m.bye = true));
    expect(loadState()).toEqual(INVALID);
  });

  it("accepts the unchanged busy matches", () => {
    storeTournamentWith(midGameState().tournament!, busyMatch, () => {});
    expect(loadState().status).toBe("ok");
  });
});

describe("champion and final must agree", () => {
  it("accepts a valid finished tournament", () => {
    const t = finishedTournament();
    expect(t.champion).toBe(t.matches[finalMatch(t)].winner);
    storeTournamentWith(t, finalMatch, () => {});
    expect(loadState()).toEqual({ status: "ok", state: { tournament: t, history: [], lang: "es" } });
  });

  it("rejects a champion who is not the winner of the final", () => {
    storeTournamentWith(finishedTournament(), finalMatch, (m, raw) => void (raw.champion = m.loser));
    expect(loadState()).toEqual(INVALID);
  });

  it("rejects a champion while the final is unfinished", () => {
    const t = midGameState().tournament!;
    expect(t.matches[finalMatch(t)].winner).toBeNull();
    storeTournamentWith(t, finalMatch, (_, raw) => void (raw.champion = "p1"));
    expect(loadState()).toEqual(INVALID);
  });

  it("rejects a champion whose final has no loser", () => {
    storeTournamentWith(finishedTournament(), finalMatch, (m) => void (m.loser = null));
    expect(loadState()).toEqual(INVALID);
  });

  it("rejects a finished final while the champion is empty", () => {
    storeTournamentWith(finishedTournament(), finalMatch, (_, raw) => void (raw.champion = null));
    expect(loadState()).toEqual(INVALID);
  });
});

describe("browser safety", () => {
  it("reports unavailable on the server (no window) and never throws", () => {
    vi.unstubAllGlobals();
    expect(typeof window).toBe("undefined");
    expect(loadState()).toEqual({ status: "unavailable" });
    expect(saveState(midGameState())).toBe(false);
    expect(clearState()).toBe(false);
  });

  it("reports unavailable when localStorage access is blocked", () => {
    vi.stubGlobal("window", {
      get localStorage(): Storage {
        throw new Error("SecurityError");
      },
    });
    expect(loadState()).toEqual({ status: "unavailable" });
    expect(saveState(midGameState())).toBe(false);
    expect(clearState()).toBe(false);
  });

  it("reports unavailable when reading throws", () => {
    storage.failGet = true;
    expect(loadState()).toEqual({ status: "unavailable" });
  });

  it("returns false instead of throwing when the storage is full", () => {
    storage.failSet = true;
    expect(saveState(midGameState())).toBe(false);
  });
});

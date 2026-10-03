# CLAUDE.md — Knockout MVP (tables grid)

> Working name: **NextBest**.
> Design reference: the clickable **"MVP · Tables grid"** artboard on the design canvas (export to `/design/tables-grid.png`). The other artboards on the canvas are **future ideas — do not build them now.**

---

## 1. What we are building (MVP only)

One screen for the **person in charge** of a tennis / table-tennis knockout tournament. Several tables play at the same time.

1. Paste the players' names (at least 5; no maximum).
2. Type the **number of tables** (e.g. 4 or 7; can change during play).
3. Press **Start**.
4. The organizer sees a **grid with one tile per table**. Each tile shows the two players currently playing there.
5. When a match ends, the organizer **taps the winner's name**. The grid updates instantly: the loser is out, the winner advances, and that table immediately gets the next waiting match.
6. Repeat until the **Champion** screen.

Rules: single elimination only. Lose once = out. No scores — only "who won".

**Priorities:** reliability → simplicity → readability (older users with glasses) → speed.

### NOT in the MVP (later)

Backend/Supabase, QR codes, share links, public viewer, big-screen/projector mode, voice input, accounts, bracket diagram, editing old results (only Undo), confirmation dialogs, animations, statistics.

---

## 2. Stack

- **Next.js 16.3.x** (latest 16.3 patch), App Router, TypeScript. The app is **client-only**: one page, `"use client"`, no server actions, no API routes, no database.
  Before writing framework code, check the installed version's docs; don't rely on memory of older Next versions.
- **Tailwind CSS v4**.
- **next-intl** (or a tiny own dictionary) for **ru / es**; language switch in the header, choice saved in localStorage.
- **Vitest** for engine tests, **Playwright** for one e2e smoke test.
- Font: **Onest** via `next/font/google`, subsets `latin`, `latin-ext`, `cyrillic`.
- Deploy: Vercel (static output is fine).

Commands: `npm run dev`, `npm run build`, `npm run test`, `npm run e2e`, `npm run lint`.

---

## 3. Structure

```
src/
  engine/            # PURE TypeScript. No React, no localStorage, no Math.random inside (inject rng).
    types.ts
    parsePlayers.ts  # text -> clean unique names
    bracket.ts       # createTournament(names, tableCount, rng)
    play.ts          # pickWinner, assignTables, setTableCount, queue, roundName
    engine.test.ts
  lib/storage.ts     # load/save/clear tournament in localStorage (versioned)
  app/page.tsx       # Setup screen  <->  Tables grid screen  <->  Champion
  components/
 messages/ru.json es.json
```

All tournament logic lives in `src/engine`. The UI only calls engine functions and renders the result.

---

## 4. Data model (stored in localStorage)

Key: `knockout:v1`. One active tournament at a time.

```ts
type Player = { id: string; name: string; out: boolean };
type Match = {
  id: string; // `${round}-${position}`
  round: number; // 1 = first round
  position: number; // index inside the round
  number: number | null; // 1..N-1 for real matches, null for BYE
  a: string | null; // player id
  b: string | null;
  winner: string | null;
  loser: string | null;
  bye: boolean;
  table: number | null; // index of the table while playing
  playedAt: number | null; // table where it was played (history)
};
type Tournament = {
  version: 1;
  createdAt: string;
  players: Record<string, Player>;
  matches: Record<string, Match>;
  rounds: number;
  bracketSize: number; // power of two, at least 8
  tables: (string | null)[]; // matchId per table, null = free
  champion: string | null;
  log: {
    winner: string;
    loser: string;
    table: number;
    round: number;
    at: string;
  }[];
};
type AppState = {
  tournament: Tournament | null;
  history: string[] /* last 50 snapshots for Undo */;
  lang: "ru" | "es";
};
```

- Save **after every action** (synchronously). Load on startup → the tournament survives refresh, closing the tab, and restarting the browser.
- Undo history in storage is **size-aware**: if the full state does not fit in localStorage (big tournaments, little space left), drop the oldest snapshots until it does — down to none. The current tournament is always saved; saving fails only if the tournament alone does not fit, and then the previous save is left untouched. In-memory Undo in the open tab is not trimmed.
- If stored data is corrupt or an unknown version → don't crash; show "Could not restore the tournament" + New tournament.
- Keep the model plain JSON so a backend can be added later without changing the engine.
- Optional: listen to the `storage` event so a second tab on the same computer (e.g. on a projector) updates too.

---

## 5. Engine rules

### Setup

- `parsePlayers`: split on new lines and commas, trim, collapse spaces, drop empties, remove duplicates (case-insensitive, keep first), report how many duplicates were removed. Valid: at least 5 names, no maximum.
- Table count: 1–16, default 4.

### Bracket

- `bracketSize` = next power of two, minimum 8 (5–8 → 8, 9–16 → 16, 17–32 → 32, 33–64 → 64, …, 129–256 → 256). Rounds = log2(size).
- Shuffle names (injected rng). Place them in the standard seed order (1v8, 4v5, 2v7, 3v6 … generated recursively) so BYEs go to the top seeds and a **BYE never faces a BYE**.
- BYE matches are completed at creation; the player moves to round 2. BYEs are invisible to the organizer and are not counted as matches.
- Real matches = **N − 1**. Number them 1..N−1 by round, then position.

### Tables (the core of the MVP)

- A match is **waiting** when both players are known and it has no winner and no table.
- **assignTables**: for every free table in order (Table 1, 2, 3…), take the first waiting match (sorted by round, then position) and put it there. Run it on Start, after every winner, after Undo-restore (not needed; restored state is already consistent), and after adding a table.
- A match becomes waiting as soon as both players are known — it does **not** wait for the whole round to finish.
- **pickWinner(matchId, playerId)**: only for a match currently on a table; player must be one of its two players. Set winner/loser, mark loser `out`, free the table, move the winner into the next round's match (slot a for even position, b for odd), add to log, then `assignTables`. If it was the final → set champion.
  Calling it again on a finished match does nothing (double-tap safe).
- **setTableCount(n)**: increasing adds free tables and assigns waiting matches. Decreasing removes tables from the end only if they are free; otherwise refuse and tell the user "Table 7 is still playing".
- **Undo**: restore the previous snapshot (up to 50). This is the MVP's way of fixing a wrong tap.
- Round names: last round "Final", then "Semifinal", "Quarterfinal", earlier "Round 1", "Round 2"… (translated).

### Invariants (check in tests after every step)

Every player in round 1 exactly once (or as a BYE recipient) · no self-matches · a table holds at most one match · a player is never on two tables · no eliminated player in an unfinished match · if a table is free and a match is waiting, it is assigned · finished tournament has exactly N−1 results, one champion, everyone else out.

### Tests (`engine.test.ts`)

For **every N from 5 to 33, plus samples around each bracket boundary up to 257 and one 500-player run** × table counts **1, 2, 4, 7, 16** × several rng seeds (fewer combinations for large N): play the whole tournament choosing random winners on random busy tables; assert all invariants after each step and exactly one champion at the end. Plus: parsing (commas, blank lines, spaces, duplicates), double tap, adding/removing tables mid-game, Undo back to the start.
E2E smoke: setup 12 players + 7 tables → play to champion → refresh mid-way keeps state.

---

## 6. Screens (see the clickable artboard)

### Setup

Title, big textarea for names, live count ("12 players" / "add at least 5"), "Number of tables" with big − / + buttons (and the number can be typed), **Start tournament** (disabled until valid). If a saved tournament exists: "Continue tournament" / "New tournament".

### Tables grid (main screen)

- Header: status "5 of 11 matches played · 8 players left", Tables − N +, **Undo**, **New** (asks "Start a new tournament? The current one will be deleted.").
- Grid of tiles, one per table. Columns: 1 table → 1, 2–4 → 2, 5–6 → 3, 7+ → 4 (on phones: 1 column, scroll). 7 tables = 4 + 3.
- Busy tile: "Table 3", round name, and **two big buttons with the players' names** — tapping a name = that player wins.
- A table that just received a new match is highlighted (lime background, "NEW") until the next action, so the organizer sees what changed.
- Free tile: dimmed, "Free".
- Side panel (below the grid on phones): **Waiting for a table** (next matches in order) and **Results** (latest first: "Anna beat Maria · Table 3 · Quarterfinal").

### Champion

Big "CHAMPION — Anna", final result, New tournament. Undo still available.

---

## 7. Readability — LARGE TEXT (older people with glasses)

- `rem` units; never block zoom; works at 200% zoom.
- **Nothing below 16px.** Body 18–20px. Buttons 20px+ bold.
- Player names on tiles: **32–44px, weight 800** (bigger when fewer columns). Names wrap; never cut off with "…".
- Table labels 26px bold. Header status 18px+.
- No thin weights (no 300) for readable text. No all-caps longer than 2 words.
- Contrast ≥ 7:1 for text. Muted text `#454B47`, never lighter.
- Tap targets ≥ 56px; name buttons ≥ 76px tall; ≥ 8px between them.
- Status is never color-only: "NEW", "Free", line-through + "beat" wording for losers.
- Optional: A / A+ text-size toggle in the header (100% / 120%), saved in localStorage.

### Colors

| Token  | Hex       | Use                            |
| ------ | --------- | ------------------------------ |
| ink    | `#0E0F0E` | text, primary buttons, borders |
| lime   | `#D3F5A7` | newly assigned table, accents  |
| mint   | `#5DE29A` | champion                       |
| sage   | `#A5ABA6` | dividers only (not text)       |
| mist   | `#E5EBEE` | page background                |
| free   | `#DCE3E6` | free table tile                |
| white  | `#FFFFFF` | tiles, cards                   |
| muted  | `#454B47` | secondary text                 |
| danger | `#B83A26` | validation errors              |

Radii: buttons 16px, tiles 22px, cards 28px. Flat, calm, big type. No gradients, no emoji.

---

## 8. Languages (ru / es )

- No hard-coded UI text; all strings in `messages/*.json`.
- ICU plurals — Russian needs one/few/many ("1 игрок / 2 игрока / 5 игроков", "1 стол / 2 стола / 5 столов").
- Test the grid in Russian: longer words must not overflow the tiles.
- Player names are never translated.

---

## 9. Build order

1. Engine + tests (all passing) — before any UI.
2. localStorage save/load + corrupt-data handling.
3. Setup screen.
4. Tables grid + tap-to-win + auto-assign + highlight.
5. Waiting / Results panel, table count changes, Undo, Champion.
6. ru/es.
7. Large-text pass (§7), phone layout, e2e smoke test.

After each step: `npm run test` and `npm run build`, then commit.

## 10. Done when

- 5 or more players (tested up to 500) with 1–16 tables always end with exactly one champion (tests).
- Tapping a name updates the grid instantly; a free table is never left empty while a match is waiting.
- Refresh / closing the browser never loses the tournament.
- Double tap never advances twice; Undo fixes a wrong tap.
- Everything is readable at arm's length with reading glasses.

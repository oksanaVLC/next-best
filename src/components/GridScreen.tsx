import { useId, type ReactNode } from "react";
import { useTranslations } from "use-intl";
import { progress, queue, roundName } from "../engine/play";
import { MAX_TABLES, MIN_TABLES, type Match, type Tournament } from "../engine/types";
import { cx, toolPrimary, toolSecondary } from "./ui";

const WAITING_SHOWN = 6;

/** Columns by table count (CLAUDE.md §6): 1 → 1, 2–4 → 2, 5–6 → 3, 7+ → 4; one column on phones. */
function gridClasses(tables: number): { grid: string; name: string } {
  if (tables <= 1) return { grid: "", name: "text-[2.25rem] md:text-[2.75rem]" };
  if (tables <= 4) return { grid: "md:grid-cols-2", name: "text-[2.25rem] md:text-[2.75rem]" };
  if (tables <= 6) return { grid: "md:grid-cols-2 xl:grid-cols-3", name: "text-[2.25rem] md:text-[2.75rem] xl:text-[2.25rem]" };
  return { grid: "md:grid-cols-2 xl:grid-cols-4", name: "text-[2.25rem] md:text-[2.75rem] xl:text-[2rem]" };
}

export function useRoundLabel() {
  const t = useTranslations("round");
  return (tournament: Tournament, round: number) => {
    const name = roundName(tournament.rounds, round);
    return name.key === "round" ? t("round", { round: name.round }) : t(name.key);
  };
}

export function GridScreen({
  tournament,
  fresh,
  canUndo,
  busyTable,
  onPick,
  onTables,
  onUndo,
  onNew,
}: {
  tournament: Tournament;
  fresh: number[];
  canUndo: boolean;
  busyTable: number | null; // table index that blocked the last "fewer tables" press
  onPick: (table: number, matchId: string, playerId: string) => void;
  onTables: (delta: 1 | -1) => void;
  onUndo: () => void;
  onNew: () => void;
}) {
  const t = useTranslations("grid");
  const tc = useTranslations("common");
  const id = useId();
  const { played, total, playersLeft } = progress(tournament);
  const layout = gridClasses(tournament.tables.length);
  const finished = tournament.champion !== null;

  return (
    <div className="flex w-full max-w-[90rem] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 id={id} className="text-[1.625rem] font-extrabold tracking-[-0.02em]">
            {t("title")}
          </h1>
          <p className="text-lg font-semibold">
            {finished ? t("finished") : t("status", { played, total, left: playersLeft })}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {!finished && <TableCount count={tournament.tables.length} onTables={onTables} />}
          <button type="button" onClick={onUndo} disabled={!canUndo} aria-label={t("undoLabel")} className={cx(toolSecondary, "flex items-center gap-2")}>
            <svg aria-hidden="true" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 14L4 9l5-5M4 9h10a6 6 0 0 1 0 12h-3" />
            </svg>
            {t("undo")}
          </button>
          <button type="button" onClick={onNew} className={toolPrimary}>
            {tc("newTournament")}
          </button>
        </div>
      </div>

      {busyTable !== null && (
        <p role="status" className="rounded-button border-l-[6px] border-danger bg-white px-5 py-4 text-xl font-bold">
          {t("tableBusy", { number: busyTable + 1 })}
        </p>
      )}

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
        {finished ? (
          <ChampionCard tournament={tournament} />
        ) : (
          <section aria-label={t("tablesLabel")} className={cx("grid min-w-0 flex-1 grid-cols-1 gap-4", layout.grid)}>
            {tournament.tables.map((matchId, i) => (
              <TableTile
                key={i}
                index={i}
                tournament={tournament}
                match={matchId === null ? null : tournament.matches[matchId]}
                isNew={fresh.includes(i)}
                nameClass={layout.name}
                onPick={onPick}
              />
            ))}
          </section>
        )}
        <div className="flex flex-col gap-4 lg:w-[20.625rem] lg:shrink-0">
          <WaitingPanel tournament={tournament} />
          <ResultsPanel tournament={tournament} />
        </div>
      </div>
    </div>
  );
}

/** Table count −/+ (1–16). The engine decides; a busy table blocks removal. */
function TableCount({ count, onTables }: { count: number; onTables: (delta: 1 | -1) => void }) {
  const t = useTranslations();
  return (
    <div role="group" aria-label={t("setup.tablesLabel")} className="flex items-center gap-3">
      <span className="text-xl font-bold">{t("grid.tablesCount")}</span>
      <button
        type="button"
        aria-label={t("setup.fewerTables")}
        disabled={count <= MIN_TABLES}
        onClick={() => onTables(-1)}
        className={cx(toolSecondary, "w-14 px-0 text-[1.875rem]")}
      >
        −
      </button>
      <span aria-live="polite" className="min-w-12 text-center text-[2.125rem] font-extrabold">
        {count}
      </span>
      <button
        type="button"
        aria-label={t("setup.moreTables")}
        disabled={count >= MAX_TABLES}
        onClick={() => onTables(1)}
        className={cx(toolSecondary, "w-14 px-0 text-[1.875rem]")}
      >
        +
      </button>
    </div>
  );
}

function TableTile({
  index,
  tournament,
  match,
  isNew,
  nameClass,
  onPick,
}: {
  index: number;
  tournament: Tournament;
  match: Match | null;
  isNew: boolean;
  nameClass: string;
  onPick: (table: number, matchId: string, playerId: string) => void;
}) {
  const t = useTranslations("grid");
  const roundLabel = useRoundLabel();
  const id = useId();
  const number = index + 1;

  if (match === null || match.a === null || match.b === null) {
    return (
      <article aria-labelledby={id} className="flex min-h-40 flex-col gap-2.5 rounded-tile border-[3px] border-free bg-free p-[1.125rem]">
        <h2 id={id} className="text-[1.625rem] font-extrabold">
          {t("table", { number })}
        </h2>
        <p className="flex flex-1 items-center justify-center text-[1.625rem] font-bold">{t("free")}</p>
      </article>
    );
  }

  const players = [match.a, match.b];
  return (
    <article
      aria-labelledby={id}
      className={cx(
        "flex flex-col gap-2.5 rounded-tile border-[3px] p-[1.125rem]",
        isNew ? "border-ink bg-lime" : "border-white bg-white",
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <h2 id={id} className="text-[1.625rem] font-extrabold">
          {t("table", { number })}
        </h2>
        <p className="flex flex-wrap items-center gap-2 text-lg font-bold">
          {isNew && <span className="rounded-lg bg-ink px-2 text-white">{t("new")}</span>}
          <span>{roundLabel(tournament, match.round)}</span>
        </p>
      </div>
      <div className="flex flex-col gap-2">
        {players.map((playerId, i) => {
          const name = tournament.players[playerId].name;
          return (
            <div key={playerId} className="contents">
              {i === 1 && <span className="text-center text-lg font-semibold text-muted">{t("versus")}</span>}
              <button
                type="button"
                aria-label={t("winsAt", { name, table: number })}
                onClick={() => onPick(index, match.id, playerId)}
                className="flex min-h-[4.75rem] w-full items-center justify-between gap-2 rounded-button border-2 border-ink bg-white px-4 py-2 text-left active:bg-mist"
              >
                <span className={cx("min-w-0 font-extrabold leading-[1.05] tracking-[-0.02em] [overflow-wrap:anywhere]", nameClass)}>
                  {name}
                </span>
                <svg aria-hidden="true" width="26" height="26" viewBox="0 0 24 24" className="shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12l5 5 9-10" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </article>
  );
}

/** Matches waiting for a table, in the engine's order. Hidden when nothing is waiting. */
function WaitingPanel({ tournament }: { tournament: Tournament }) {
  const t = useTranslations("grid");
  const id = useId();
  const waiting = queue(tournament);
  if (waiting.length === 0) return null;
  const name = (playerId: string | null) => (playerId === null ? "" : tournament.players[playerId].name);

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-tile bg-ink p-5 text-white">
      <h2 id={id} className="text-lg font-bold text-lime">
        {t("waitingTitle")}
      </h2>
      <ol className="flex flex-col gap-3">
        {waiting.slice(0, WAITING_SHOWN).map((m) => (
          <li key={m.id} className="text-[1.375rem] font-bold leading-tight [overflow-wrap:anywhere]">
            {t("matchup", { a: name(m.a), b: name(m.b) })}
          </li>
        ))}
        {waiting.length > WAITING_SHOWN && (
          <li className="text-xl">{t("waitingMore", { count: waiting.length - WAITING_SHOWN })}</li>
        )}
      </ol>
    </section>
  );
}

const winnerTag = (chunks: ReactNode) => <strong className="font-extrabold">{chunks}</strong>;
const loserTag = (chunks: ReactNode) => <s className="text-muted">{chunks}</s>;

/** Finished matches from the tournament log, newest first. */
function ResultsPanel({ tournament }: { tournament: Tournament }) {
  const t = useTranslations("grid");
  const roundLabel = useRoundLabel();
  const id = useId();
  const results = [...tournament.log].reverse();

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-tile bg-white p-5">
      <h2 id={id} className="text-lg font-bold">
        {t("resultsTitle")}
      </h2>
      {results.length === 0 ? (
        <p className="text-xl text-muted">{t("resultsEmpty")}</p>
      ) : (
        <ol className="flex flex-col">
          {results.map((entry, i) => (
            <li key={results.length - i} className="flex flex-col gap-0.5 border-b-2 border-mist py-2.5 last:border-b-0">
              <span className="text-[1.3125rem] leading-snug [overflow-wrap:anywhere]">
                {t.rich("result", {
                  winner: tournament.players[entry.winner].name,
                  loser: tournament.players[entry.loser].name,
                  w: winnerTag,
                  l: loserTag,
                })}
              </span>
              <span className="text-lg text-muted">
                {t("resultWhere", { table: entry.table + 1, round: roundLabel(tournament, entry.round) })}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Shown instead of the tables once the engine reports a champion. */
function ChampionCard({ tournament }: { tournament: Tournament }) {
  const t = useTranslations("champion");
  const id = useId();
  const final = tournament.matches[`${tournament.rounds}-0`];
  const name = (playerId: string | null) => (playerId === null ? "" : tournament.players[playerId].name);

  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-1 flex-col gap-4 rounded-card bg-mint p-6 sm:p-10 lg:p-14">
      <h2 id={id} className="flex flex-col gap-3">
        <span className="text-[1.75rem] font-bold sm:text-[2rem]">{t("title")}</span>{" "}
        <span className="text-[3.5rem] font-extrabold leading-[0.95] tracking-[-0.04em] [overflow-wrap:anywhere] sm:text-[6rem] xl:text-[8rem]">
          {name(tournament.champion)}
        </span>
      </h2>
      <div className="mt-4 flex flex-col gap-2 border-t-[3px] border-ink pt-4 text-xl font-semibold sm:text-[1.75rem]">
        <p>
          {t("summary", { players: Object.keys(tournament.players).length, matches: tournament.log.length })}
        </p>
        <p className="[overflow-wrap:anywhere]">
          {t.rich("final", {
            winner: name(final.winner),
            loser: name(final.loser),
            w: winnerTag,
            l: (chunks: ReactNode) => <s>{chunks}</s>,
          })}
        </p>
      </div>
    </section>
  );
}

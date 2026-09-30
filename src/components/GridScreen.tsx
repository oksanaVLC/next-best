import { useId } from "react";
import { useTranslations } from "use-intl";
import { progress, queue, roundName } from "../engine/play";
import type { Match, Tournament } from "../engine/types";
import { cx } from "./ui";

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
  onPick,
  onNew,
}: {
  tournament: Tournament;
  fresh: number[];
  onPick: (table: number, matchId: string, playerId: string) => void;
  onNew: () => void;
}) {
  const t = useTranslations("grid");
  const tc = useTranslations("common");
  const id = useId();
  const { played, total, playersLeft } = progress(tournament);
  const layout = gridClasses(tournament.tables.length);

  return (
    <div className="flex w-full max-w-[90rem] flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-col gap-0.5">
          <h1 id={id} className="text-[1.625rem] font-extrabold tracking-[-0.02em]">
            {t("title")}
          </h1>
          <p className="text-lg font-semibold">{t("status", { played, total, left: playersLeft })}</p>
        </div>
        <button type="button" onClick={onNew} className="min-h-14 rounded-button bg-ink px-5 text-xl font-bold text-white">
          {tc("newTournament")}
        </button>
      </div>

      <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
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
        <WaitingPanel tournament={tournament} />
      </div>
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

function WaitingPanel({ tournament }: { tournament: Tournament }) {
  const t = useTranslations("grid");
  const id = useId();
  const waiting = queue(tournament);
  const name = (playerId: string | null) => (playerId === null ? "" : tournament.players[playerId].name);

  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-tile bg-ink p-5 text-white lg:w-[20.625rem] lg:shrink-0">
      <h2 id={id} className="text-lg font-bold text-lime">
        {t("waitingTitle")}
      </h2>
      {waiting.length === 0 ? (
        <p className="text-xl">{t("waitingNone")}</p>
      ) : (
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
      )}
    </section>
  );
}

export function ChampionPlaceholder({ tournament, onNew }: { tournament: Tournament; onNew: () => void }) {
  const t = useTranslations();
  const id = useId();
  const champion = tournament.champion ? tournament.players[tournament.champion].name : "";
  return (
    <section aria-labelledby={id} className="flex w-full max-w-[47.5rem] flex-col gap-6 rounded-card bg-mint p-6 sm:p-10">
      <h1 id={id} className="flex flex-col gap-2">
        <span className="text-2xl font-bold">{t("champion.title")}</span>{" "}
        <span className="text-[3.5rem] font-extrabold leading-none tracking-[-0.04em] [overflow-wrap:anywhere] sm:text-[5rem]">
          {champion}
        </span>
      </h1>
      <button type="button" onClick={onNew} className="min-h-14 self-start rounded-button bg-ink px-5 text-xl font-bold text-white">
        {t("common.newTournament")}
      </button>
    </section>
  );
}

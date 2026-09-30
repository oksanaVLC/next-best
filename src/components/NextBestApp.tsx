"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { IntlProvider, useTranslations } from "use-intl";
import { createTournament } from "../engine/bracket";
import { newlyAssignedTables, pickWinner, pushHistory } from "../engine/play";
import type { AppState } from "../engine/types";
import { detectLang, messages, type Lang } from "../i18n";
import { loadState, saveState } from "../lib/storage";
import { AppHeader } from "./AppHeader";
import { ChampionPlaceholder, GridScreen } from "./GridScreen";
import { ConfirmNewScreen, RecoverScreen, ResumeScreen } from "./SavedScreens";
import { SetupScreen } from "./SetupScreen";

/**
 * A table that has just received a new match ignores taps for this long, so a double tap on a
 * name cannot also pick a winner in the next match that appears under the same finger.
 */
export const NEW_MATCH_TAP_GUARD_MS = 1000;

type Screen =
  | { name: "setup" }
  | { name: "resume" }
  | { name: "confirmNew"; back: "resume" | "grid" }
  | { name: "recover" }
  | { name: "grid" };

type Model = {
  screen: Screen;
  app: AppState;
  canSave: boolean; // false when the browser has no usable localStorage
  saveFailed: boolean;
  fresh: number[]; // tables that received a match in the last action ("NEW")
  freshAt: number; // when that happened (ms)
};

const noopSubscribe = () => () => {};

/** False during the server render and hydration, true afterwards (no setState in an effect needed). */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export default function NextBestApp() {
  const isClient = useIsClient();
  // The server cannot see localStorage, so it renders an empty page; the client fills it in.
  if (!isClient) return <div className="min-h-dvh bg-mist" aria-busy="true" />;
  return <LoadedApp />;
}

function initialModel(): Model {
  const blank: AppState = { tournament: null, history: [], lang: detectLang(navigator.languages) };
  const base = { canSave: true, saveFailed: false, fresh: [], freshAt: 0 };
  const result = loadState();
  switch (result.status) {
    case "ok":
      return { ...base, screen: { name: result.state.tournament ? "resume" : "setup" }, app: result.state };
    case "empty":
      return { ...base, screen: { name: "setup" }, app: blank };
    case "invalid":
      return { ...base, screen: { name: "recover" }, app: blank };
    case "unavailable":
      return { ...base, screen: { name: "setup" }, app: blank, canSave: false };
  }
}

function LoadedApp() {
  const [model, setModel] = useState(initialModel);
  // Handlers read the latest model from here, so two taps in the same frame never act on stale state.
  const latest = useRef(model);
  const { screen, app } = model;

  useEffect(() => {
    document.documentElement.lang = app.lang;
  }, [app.lang]);

  function apply(next: Model) {
    latest.current = next;
    setModel(next);
  }

  /** `m` with `next` as the app state, saved (unless storage is missing). */
  function saved(m: Model, next: AppState): Model {
    return { ...m, app: next, saveFailed: m.canSave && !saveState(next) };
  }

  function show(nextScreen: Screen) {
    apply({ ...latest.current, screen: nextScreen, fresh: [] });
  }

  function changeLang(lang: Lang) {
    const m = latest.current;
    // While recovering, keep the unreadable data untouched until the user chooses New.
    const next = { ...m.app, lang };
    apply(m.screen.name === "recover" ? { ...m, app: next } : saved(m, next));
  }

  function start(names: string[], tables: number) {
    const m = latest.current;
    const tournament = createTournament(names, tables, Math.random);
    apply({
      ...saved(m, { tournament, history: [], lang: m.app.lang }),
      screen: { name: "grid" },
      fresh: newlyAssignedTables(null, tournament),
      freshAt: Date.now(),
    });
  }

  function pick(table: number, matchId: string, playerId: string) {
    const m = latest.current;
    const before = m.app.tournament;
    if (!before) return;
    if (m.fresh.includes(table) && Date.now() - m.freshAt < NEW_MATCH_TAP_GUARD_MS) return;
    const after = pickWinner(before, matchId, playerId);
    if (after === before) return; // finished, stale or invalid tap: no history, no save
    apply({
      ...saved(m, { ...m.app, tournament: after, history: pushHistory(m.app.history, before) }),
      fresh: newlyAssignedTables(before, after),
      freshAt: Date.now(),
    });
  }

  function startOver() {
    // Also overwrites unreadable data, so the recovery message does not come back.
    const m = latest.current;
    apply({ ...saved(m, { tournament: null, history: [], lang: m.app.lang }), screen: { name: "setup" }, fresh: [] });
  }

  const onGrid = screen.name === "grid" && app.tournament;

  return (
    <IntlProvider locale={app.lang} messages={messages[app.lang]}>
      <div className="flex min-h-dvh flex-col">
        <AppHeader lang={app.lang} onLangChange={changeLang} />
        <main
          className={
            onGrid
              ? "flex flex-1 flex-col items-center gap-4 px-4 pb-8 sm:px-7 sm:pb-7"
              : "flex flex-1 flex-col items-center gap-4 px-4 pb-8 sm:justify-center sm:px-10 sm:pb-10"
          }
        >
          <StorageNotice canSave={model.canSave} saveFailed={model.saveFailed} />
          {screen.name === "setup" && <SetupScreen onStart={start} />}
          {screen.name === "resume" && app.tournament && (
            <ResumeScreen
              tournament={app.tournament}
              onContinue={() => show({ name: "grid" })}
              onNew={() => show({ name: "confirmNew", back: "resume" })}
            />
          )}
          {screen.name === "confirmNew" && (
            <ConfirmNewScreen onConfirm={startOver} onCancel={() => show({ name: screen.back })} />
          )}
          {screen.name === "recover" && <RecoverScreen onNew={startOver} />}
          {screen.name === "grid" &&
            app.tournament &&
            (app.tournament.champion ? (
              <ChampionPlaceholder tournament={app.tournament} onNew={() => show({ name: "confirmNew", back: "grid" })} />
            ) : (
              <GridScreen
                tournament={app.tournament}
                fresh={model.fresh}
                onPick={pick}
                onNew={() => show({ name: "confirmNew", back: "grid" })}
              />
            ))}
        </main>
      </div>
    </IntlProvider>
  );
}

function StorageNotice({ canSave, saveFailed }: { canSave: boolean; saveFailed: boolean }) {
  const t = useTranslations("storage");
  if (canSave && !saveFailed) return null;
  return (
    <p role="status" className="w-full max-w-[47.5rem] rounded-button border-l-[6px] border-danger bg-white px-5 py-4 text-xl font-bold">
      {canSave ? t("saveFailed") : t("unavailable")}
    </p>
  );
}

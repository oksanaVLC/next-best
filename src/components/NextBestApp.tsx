"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { IntlProvider, useTranslations } from "use-intl";
import { createTournament } from "../engine/bracket";
import type { AppState } from "../engine/types";
import { detectLang, messages, type Lang } from "../i18n";
import { loadState, saveState } from "../lib/storage";
import { AppHeader } from "./AppHeader";
import { ConfirmNewScreen, RecoverScreen, ResumeScreen, StartedPlaceholder } from "./SavedScreens";
import { SetupScreen } from "./SetupScreen";

type Screen =
  | { name: "setup" }
  | { name: "resume" }
  | { name: "confirmNew"; back: "resume" | "started" }
  | { name: "recover" }
  | { name: "started" }; // placeholder until the tables grid exists (Step 4)

type Model = {
  screen: Screen;
  app: AppState;
  canSave: boolean; // false when the browser has no usable localStorage
  saveFailed: boolean;
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
  const result = loadState();
  switch (result.status) {
    case "ok":
      return {
        screen: { name: result.state.tournament ? "resume" : "setup" },
        app: result.state,
        canSave: true,
        saveFailed: false,
      };
    case "empty":
      return { screen: { name: "setup" }, app: blank, canSave: true, saveFailed: false };
    case "invalid":
      return { screen: { name: "recover" }, app: blank, canSave: true, saveFailed: false };
    case "unavailable":
      return { screen: { name: "setup" }, app: blank, canSave: false, saveFailed: false };
  }
}

function LoadedApp() {
  const [model, setModel] = useState(initialModel);
  const { screen, app } = model;

  useEffect(() => {
    document.documentElement.lang = app.lang;
  }, [app.lang]);

  /** Show `next` and save it (unless storage is missing or `persist` is false). */
  function commit(next: AppState, nextScreen: Screen, persist = true) {
    const failed = persist && model.canSave && !saveState(next);
    setModel({ ...model, app: next, screen: nextScreen, saveFailed: failed });
  }

  function show(nextScreen: Screen) {
    setModel({ ...model, screen: nextScreen });
  }

  function startOver() {
    // Also overwrites unreadable data, so the recovery message does not come back.
    commit({ tournament: null, history: [], lang: app.lang }, { name: "setup" });
  }

  return (
    <IntlProvider locale={app.lang} messages={messages[app.lang]}>
      <div className="flex min-h-dvh flex-col">
        <AppHeader
          lang={app.lang}
          // While recovering, keep the unreadable data untouched until the user chooses New.
          onLangChange={(lang: Lang) => commit({ ...app, lang }, screen, screen.name !== "recover")}
        />
        <main className="flex flex-1 flex-col items-center gap-4 px-4 pb-8 sm:justify-center sm:px-10 sm:pb-10">
          <StorageNotice canSave={model.canSave} saveFailed={model.saveFailed} />
          {screen.name === "setup" && (
            <SetupScreen
              onStart={(names, tables) =>
                commit({ tournament: createTournament(names, tables, Math.random), history: [], lang: app.lang }, { name: "started" })
              }
            />
          )}
          {screen.name === "resume" && app.tournament && (
            <ResumeScreen
              tournament={app.tournament}
              onContinue={() => show({ name: "started" })}
              onNew={() => show({ name: "confirmNew", back: "resume" })}
            />
          )}
          {screen.name === "confirmNew" && (
            <ConfirmNewScreen onConfirm={startOver} onCancel={() => show({ name: screen.back })} />
          )}
          {screen.name === "recover" && <RecoverScreen onNew={startOver} />}
          {screen.name === "started" && app.tournament && (
            <StartedPlaceholder tournament={app.tournament} onNew={() => show({ name: "confirmNew", back: "started" })} />
          )}
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

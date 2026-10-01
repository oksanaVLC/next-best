import { useId, useMemo, useState } from "react";
import { useTranslations } from "use-intl";
import { parsePlayers } from "../engine/parsePlayers";
import { DEFAULT_TABLES, MAX_PLAYERS, MAX_TABLES, MIN_PLAYERS, MIN_TABLES } from "../engine/types";
import { parseTableInput, stepTableInput } from "../lib/tableInput";
import { card, cardTitle, cx, primaryButton } from "./ui";

const stepButton =
  "size-16 shrink-0 rounded-[1.125rem] border-2 border-ink bg-white text-[2.125rem] font-bold leading-none aria-disabled:border-sage aria-disabled:text-muted";

export function SetupScreen({ onStart }: { onStart: (names: string[], tables: number) => void }) {
  const t = useTranslations("setup");
  const id = useId();
  const [namesText, setNamesText] = useState("");
  const [tablesText, setTablesText] = useState(String(DEFAULT_TABLES));

  const parsed = useMemo(() => parsePlayers(namesText), [namesText]);
  const count = parsed.names.length;
  const tables = parseTableInput(tablesText);
  const canStart = parsed.status === "ok" && tables !== null;
  // An empty box is a neutral hint, not an error.
  const playersError = parsed.status !== "ok" && count > 0;

  const countText =
    parsed.status === "ok"
      ? t("countOk", { count })
      : parsed.status === "tooFew"
        ? t("countTooFew", { count, min: MIN_PLAYERS })
        : t("countTooMany", { count, max: MAX_PLAYERS });

  return (
    <section className={card} aria-labelledby={`${id}-title`}>
      <h1 id={`${id}-title`} tabIndex={-1} data-autofocus className={cardTitle}>
        {t("title")}
      </h1>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <label htmlFor={`${id}-names`} className="text-xl font-bold">
            {t("playersLabel")}
          </label>
          <span id={`${id}-hint`} className="text-lg text-muted">
            {t("playersHint")}
          </span>
        </div>
        <textarea
          id={`${id}-names`}
          value={namesText}
          onChange={(e) => setNamesText(e.target.value)}
          aria-describedby={`${id}-hint ${id}-count`}
          aria-invalid={playersError}
          spellCheck={false}
          autoComplete="off"
          className={cx(
            "h-64 resize-none rounded-[1.125rem] border-2 bg-white px-5 py-4 text-[1.375rem] leading-snug sm:h-[18.75rem]",
            playersError ? "border-danger" : "border-ink",
          )}
        />
        <div id={`${id}-count`} aria-live="polite" className="flex flex-col gap-1">
          <p
            className={cx(
              "text-xl font-bold",
              playersError && "border-l-[6px] border-danger pl-3",
              count === 0 && "text-muted",
            )}
          >
            {countText}
          </p>
          {parsed.duplicatesRemoved > 0 && (
            <p className="text-lg text-muted">{t("duplicates", { count: parsed.duplicatesRemoved })}</p>
          )}
        </div>
      </div>

      <div className="flex flex-col gap-3 border-t-2 border-ink pt-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label htmlFor={`${id}-tables`} className="text-2xl font-bold">
            {t("tablesLabel")}
          </label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              aria-label={t("fewerTables")}
              aria-controls={`${id}-tables`}
              aria-disabled={tables !== null && tables <= MIN_TABLES}
              onClick={() => setTablesText(String(stepTableInput(tablesText, -1)))}
              className={stepButton}
            >
              −
            </button>
            <input
              id={`${id}-tables`}
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              autoComplete="off"
              value={tablesText}
              onChange={(e) => setTablesText(e.target.value)}
              aria-invalid={tables === null}
              aria-describedby={tables === null ? `${id}-tables-error` : undefined}
              className={cx(
                "h-16 w-24 rounded-[1.125rem] border-2 bg-white text-center text-5xl font-extrabold",
                tables === null ? "border-danger" : "border-white",
              )}
            />
            <button
              type="button"
              aria-label={t("moreTables")}
              aria-controls={`${id}-tables`}
              aria-disabled={tables !== null && tables >= MAX_TABLES}
              onClick={() => setTablesText(String(stepTableInput(tablesText, 1)))}
              className={stepButton}
            >
              +
            </button>
          </div>
        </div>
        {tables === null && (
          <p id={`${id}-tables-error`} role="alert" className="border-l-[6px] border-danger pl-3 text-xl font-bold">
            {t("tablesInvalid", { min: MIN_TABLES, max: MAX_TABLES })}
          </p>
        )}
      </div>

      <button
        type="button"
        disabled={!canStart}
        onClick={() => {
          if (canStart) onStart(parsed.names, tables);
        }}
        className={primaryButton}
      >
        {t("start")}
      </button>
    </section>
  );
}

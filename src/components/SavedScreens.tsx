// Screens shown around a saved tournament: resume, confirm New and recover.

import { useId } from "react";
import { useTranslations } from "use-intl";
import { progress } from "../engine/play";
import type { Tournament } from "../engine/types";
import { card, cardTitle, primaryButton, secondaryButton } from "./ui";

function Summary({ tournament }: { tournament: Tournament }) {
  const t = useTranslations("common");
  const { played, total } = progress(tournament);
  return (
    <ul className="flex flex-col gap-1 text-xl font-semibold">
      <li>{t("players", { count: Object.keys(tournament.players).length })}</li>
      <li>{t("tables", { count: tournament.tables.length })}</li>
      <li>{t("played", { played, total })}</li>
    </ul>
  );
}

export function ResumeScreen({
  tournament,
  onContinue,
  onNew,
}: {
  tournament: Tournament;
  onContinue: () => void;
  onNew: () => void;
}) {
  const t = useTranslations();
  const id = useId();
  return (
    <section className={card} aria-labelledby={id}>
      <h1 id={id} className={cardTitle}>
        {t("resume.title")}
      </h1>
      <Summary tournament={tournament} />
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onContinue} className={primaryButton}>
          {t("resume.continue")}
        </button>
        <button type="button" onClick={onNew} className={secondaryButton}>
          {t("common.newTournament")}
        </button>
      </div>
    </section>
  );
}

export function ConfirmNewScreen({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const t = useTranslations("confirmNew");
  const id = useId();
  return (
    <section className={card} aria-labelledby={id}>
      <h1 id={id} className="text-[1.75rem] font-extrabold leading-tight sm:text-[2rem]">
        {t("question")}
      </h1>
      <div className="flex flex-col gap-3">
        <button type="button" onClick={onConfirm} className={primaryButton}>
          {t("yes")}
        </button>
        <button type="button" onClick={onCancel} className={secondaryButton}>
          {t("cancel")}
        </button>
      </div>
    </section>
  );
}

export function RecoverScreen({ onNew }: { onNew: () => void }) {
  const t = useTranslations();
  const id = useId();
  return (
    <section className={card} aria-labelledby={id}>
      <h1 id={id} className={cardTitle}>
        {t("recover.title")}
      </h1>
      <p className="text-xl">{t("recover.body")}</p>
      <button type="button" onClick={onNew} className={primaryButton}>
        {t("common.newTournament")}
      </button>
    </section>
  );
}

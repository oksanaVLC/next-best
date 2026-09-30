import { useTranslations } from "use-intl";
import { LANGS, type Lang } from "../i18n";
import { cx } from "./ui";

export function AppHeader({ lang, onLangChange }: { lang: Lang; onLangChange: (lang: Lang) => void }) {
  const t = useTranslations();
  return (
    <header className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3 px-4 py-4 sm:px-7">
      <span className="text-[1.625rem] font-extrabold tracking-[-0.02em]">{t("app.name")}</span>
      <div role="group" aria-label={t("language.label")} className="flex gap-2">
        {LANGS.map((code) => (
          <button
            key={code}
            type="button"
            lang={code}
            aria-pressed={code === lang}
            onClick={() => onLangChange(code)}
            className={cx(
              "min-h-14 rounded-button border-2 border-ink px-4 text-xl font-bold",
              code === lang ? "bg-ink text-white" : "bg-white text-ink",
            )}
          >
            {t(`language.${code}`)}
          </button>
        ))}
      </div>
    </header>
  );
}

// Shared Tailwind classes, sized for readability (CLAUDE.md §7): nothing below 16px, tap targets ≥ 56px.

export const card = "flex w-full max-w-[47.5rem] flex-col gap-6 rounded-card bg-white p-6 sm:p-10";

export const cardTitle = "text-[2.25rem] font-extrabold leading-tight tracking-[-0.03em] sm:text-[2.75rem]";

const bigButton = "min-h-[4.75rem] w-full rounded-[1.25rem] px-6 py-3 text-[1.625rem] font-bold leading-tight";

// Disabled: grey fill with ink text (14.8:1); muted text on the grey would be only 6.9:1.
export const primaryButton = `${bigButton} bg-ink text-white disabled:bg-free disabled:text-ink`;

export const secondaryButton = `${bigButton} border-2 border-ink bg-white text-ink`;

const toolButton = "min-h-14 rounded-button px-5 text-xl font-bold leading-tight";

/** Header tools (Undo, table −/+). Disabled keeps 8.9:1 text; the sage border only marks the state. */
export const toolSecondary = `${toolButton} border-2 border-ink bg-white text-ink disabled:border-sage disabled:text-muted`;

export const toolPrimary = `${toolButton} bg-ink text-white`;

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

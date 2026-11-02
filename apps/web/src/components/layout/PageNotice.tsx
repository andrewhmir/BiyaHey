export interface PageNoticeAction {
  label: string;
  onClick: () => void;
}

export interface PageNoticeProps {
  title: string;
  message: string;
  primary: PageNoticeAction;
  secondary?: PageNoticeAction;
}

/**
 * Honest full-page state: a title, a reason, and real ways forward.
 *
 * Used by the `/plan` origin/destination guards and the `/trip` missing-cache
 * notice. It is a plain page, not a dialog: there is nothing to return to, so
 * the rider gets the reason and the next action instead of an empty screen.
 */
export function PageNotice({ title, message, primary, secondary }: PageNoticeProps) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-surface px-6 text-center text-on-surface">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="max-w-md text-sm text-on-surface-variant">{message}</p>
      <div className="mt-2 flex w-full max-w-xs flex-col gap-2">
        <button
          type="button"
          onClick={primary.onClick}
          className="flex min-h-12 items-center justify-center rounded-pill bg-primary px-6 text-base font-medium text-on-primary transition hover:opacity-90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring active:opacity-80"
        >
          {primary.label}
        </button>
        {secondary !== undefined ? (
          <button
            type="button"
            onClick={secondary.onClick}
            className="flex min-h-12 items-center justify-center rounded-pill border border-outline-variant bg-surface-container-lowest px-6 text-base font-medium text-on-surface transition hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring"
          >
            {secondary.label}
          </button>
        ) : null}
      </div>
    </main>
  );
}

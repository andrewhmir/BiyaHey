import { useT } from '../../i18n/useT';

export interface FilterChipOption<T extends string> {
  value: T;
  label: string;
}

export interface FilterChipsProps<T extends string> {
  options: readonly FilterChipOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Accessible name for the chip group. */
  label?: string;
}

/**
 * One local filter row; pressing a chip reports the new ranking, never a fetch.
 *
 * Kalsada v2: a single horizontally scrollable row of 48 dp pills (the sheet is
 * narrow, so the row scrolls instead of wrapping). The active chip is filled
 * with the ink `inverse-surface` role and the inactive chips are quiet
 * `surface-container` pills with a hairline outline. Selection is exposed with
 * `aria-pressed`, and the group keeps its accessible name.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
}: FilterChipsProps<T>) {
  const { t } = useT();

  return (
    <div
      role="group"
      aria-label={label ?? t('routes.filterLabel')}
      data-testid="filter-chips"
      className="flex flex-nowrap gap-2 overflow-x-auto pb-1 [scrollbar-width:none]"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`min-h-12 shrink-0 rounded-pill border px-4 text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
              active
                ? 'border-transparent bg-inverse-surface text-inverse-on-surface'
                : 'border-outline-variant bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

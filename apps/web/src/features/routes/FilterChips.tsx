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

/** One local filter row; pressing a chip reports the new ranking, never a fetch. */
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
      className="flex flex-wrap gap-2"
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`min-h-12 rounded-pill border px-4 text-sm font-medium transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus-ring ${
              active
                ? 'border-transparent bg-secondary-container text-on-secondary-container'
                : 'border-outline-variant bg-surface-container-lowest text-on-surface hover:bg-surface-container'
            }`}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

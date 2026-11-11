import { useCopy } from '../../i18n';
import { FILTER_OPTIONS, type RouteFilter } from './rankItineraries';

interface FilterChipsProps {
  value: RouteFilter;
  onChange: (filter: RouteFilter) => void;
}

/** One local filter row; a chip re-ranks the list and never triggers a fetch. */
export function FilterChips({ value, onChange }: FilterChipsProps) {
  const { t } = useCopy();

  return (
    <div role="group" aria-label={t('routes.filterLabel')} className="flex flex-wrap gap-2">
      {FILTER_OPTIONS.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(option.value)}
            className={`min-h-12 rounded-md border px-3 text-sm font-semibold transition sm:px-4 ${
              active
                ? 'border-brand bg-brand text-white'
                : 'border-line-strong bg-white text-ink-soft hover:border-brand hover:text-brand'
            }`}
          >
            {t(option.labelKey)}
          </button>
        );
      })}
    </div>
  );
}

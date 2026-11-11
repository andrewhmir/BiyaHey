import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { useCopy } from '../../i18n';

export interface PlaceFieldProps {
  id: string;
  label: string;
  placeholder: string;
  value: string;
  icon: ReactNode;
  inputRef?: (element: HTMLInputElement | null) => void;
  onFocus: () => void;
  onChange: (value: string) => void;
  onClear?: () => void;
  /** Extra 48 dp actions after the clear button (locate / swap / remove). */
  trailing?: ReactNode;
}

/** One labelled place field with its clear affordance and trailing actions. */
export function PlaceField({
  id,
  label,
  placeholder,
  value,
  icon,
  inputRef,
  onFocus,
  onChange,
  onClear,
  trailing,
}: PlaceFieldProps) {
  const { t } = useCopy();

  return (
    <div className="flex items-center gap-2 px-3">
      <span
        aria-hidden="true"
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-canvas text-ink-faint"
      >
        {icon}
      </span>
      <div className="min-w-0 flex-1 py-1.5">
        <label
          htmlFor={id}
          className="block text-[10px] font-semibold uppercase tracking-wide text-ink-faint"
        >
          {label}
        </label>
        <input
          id={id}
          ref={inputRef}
          type="text"
          autoComplete="off"
          enterKeyHint="search"
          value={value}
          placeholder={placeholder}
          onFocus={onFocus}
          onChange={(event) => onChange(event.currentTarget.value)}
          className="h-9 w-full min-w-0 bg-transparent text-sm font-medium text-ink placeholder:font-normal placeholder:text-ink-faint focus:outline-none"
        />
      </div>
      {onClear !== undefined && value.length > 0 ? (
        <button
          type="button"
          onClick={onClear}
          aria-label={t('search.clear')}
          className="flex size-12 shrink-0 items-center justify-center rounded-full text-ink-faint transition hover:bg-canvas hover:text-ink"
        >
          <X aria-hidden="true" className="size-4" />
        </button>
      ) : null}
      {trailing}
    </div>
  );
}

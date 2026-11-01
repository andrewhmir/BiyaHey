import type { ReactNode } from 'react';
import { MapSlot } from './MapSlot';

export interface AppShellProps {
  /** Map layer; defaults to the Task 2 placeholder until Task 3 lands. */
  map?: ReactNode;
  /** Sheet layer. `BottomSheet` re-enables pointer events on itself. */
  sheet: ReactNode;
}

/**
 * Full-bleed map with a non-modal sheet layered above it. The sheet layer is
 * pointer-events-none so the map (and any controls outside the sheet) stays
 * interactive; `BottomSheet` opts back in with `pointer-events-auto`.
 */
export function AppShell({ map, sheet }: AppShellProps) {
  return (
    <main className="relative isolate h-dvh w-full overflow-hidden bg-surface font-sans text-on-surface">
      <div className="absolute inset-0">{map ?? <MapSlot />}</div>
      <div className="pointer-events-none absolute inset-0 z-10">{sheet}</div>
    </main>
  );
}

import { useCopy } from '../i18n';

/** Required basemap attribution. Always painted, independent of the map chunk. */
export function MapCredit() {
  const { t } = useCopy();
  return (
    <p className="pointer-events-auto rounded-full bg-white/90 px-2.5 py-1 text-[10px] leading-4 text-ink-soft shadow-sm">
      <a href="https://www.openstreetmap.org/copyright" className="hover:underline">
        © OpenStreetMap
      </a>
      <span aria-hidden="true"> · </span>
      <a href="https://openfreemap.org" className="hover:underline">
        OpenFreeMap
      </a>
      <span aria-hidden="true"> · </span>
      <a href="https://openmaptiles.org/" className="hover:underline">
        © OpenMapTiles
      </a>
      <span aria-hidden="true"> · </span>
      <span className="sr-only">{t('footer.data')}</span>
    </p>
  );
}

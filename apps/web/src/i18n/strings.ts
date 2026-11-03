/**
 * Taglish string module (R44) — the single source of user-facing copy.
 *
 * `tl` is the default locale: the rider-facing Taglish voice from spec §11.
 * `en` is a complete English fallback for every key, not a partial patch.
 * Strings are plain templates; `{name}` placeholders are filled by
 * {@link translate}. Screen code never branches on the locale for grammar.
 *
 * R44 preservation rule: a handful of strings are mandated verbatim by the
 * plan/spec and are asserted by existing tests (offline copy, empty-route copy,
 * the saved-fare staleness sentence, the saved-snapshot labels, the
 * "no live data — expected wait" banner, and the "Last updated" line). They
 * stay byte-identical in `tl`; moving them into this module must not change
 * what renders. `strings.test.ts` pins each one.
 *
 * R45: attribution, fares and licence identifiers are API data and never live
 * here. The only hardcoded credit is the tile-provider/OSM wording the basemap
 * licence requires (`MapCredit`), plus the documented SPDX display names in
 * `features/provenance/licences.ts`.
 */

export type Locale = 'tl' | 'en';

export type StringVars = Readonly<Record<string, string | number>>;

/** A translate function bound to one locale (`useT()` returns this shape). */
export type Translate = (key: string, vars?: StringVars) => string;

const TL = {
  // --- Shared -------------------------------------------------------------
  'common.back': 'Bumalik',
  'common.retry': 'Subukan ulit',
  'common.cancel': 'Kanselahin',
  'common.close': 'Isara',
  'common.save': 'I-save',
  'common.saved': 'Nai-save',
  'common.delete': 'I-delete',
  'common.open': 'Buksan',
  'common.undo': 'Undo',
  'common.fare': 'Pamasahe',
  'common.estimate': 'Estimate',
  'common.aboutData': 'About data',
  'common.dataSources': 'Pinagmulan ng data',
  'common.offline': 'Offline',
  'common.loading': 'Naglo-load…',

  // --- Home ---------------------------------------------------------------
  'home.sheetLabel': 'Home',
  'home.eyebrow': 'Plano ng biyahe',
  'home.brand': 'BiyaHey!',
  'home.hint': 'Hilahin pataas ang sheet para makapag-plano ng ruta.',
  'home.saved': 'Naka-save at kamakailan',

  // --- Search -------------------------------------------------------------
  'search.placeholder': 'Saan ka pupunta?',
  'search.label': 'Maghanap ng lugar',
  'search.heading': 'Saan papunta?',
  'search.clear': 'Burahin ang search',
  // Trip planner (R89, Option A): /search is a directions form.
  'search.title': 'Plano ng biyahe',
  'search.fromLabel': 'Mula sa',
  'search.toLabel': 'Papunta sa',
  'search.fromPlaceholder': 'Saan ka galing?',
  'search.stopPlaceholder': 'Saan ka hihinto?',
  'search.stopLabel': 'Hintuan {index}',
  'search.addStop': 'Magdagdag ng hintuan',
  'search.removeStop': 'Alisin ang hintuan',
  'search.removeStopIndex': 'Alisin ang hintuan {index}',
  'search.swap': 'Palitan ang mula at papunta',
  'search.useMyLocation': 'Gamitin ang lokasyon ko',
  'search.findRoute': 'Maghanap ng ruta',
  'search.noStops': 'Walang hintuang nakita para sa “{query}”.',
  'search.partialNoStops': 'Walang kumpletong hintuang nakita para sa “{query}”.',
  'search.locateDenied':
    'Hindi pinayagan ang lokasyon. Pumili ng lugar para sa “Mula sa” o subukan ulit.',
  'search.locateUnavailable':
    'Hindi available ang lokasyon sa device na ito. Pumili ng lugar para sa “Mula sa”.',
  'search.locateTimeout':
    'Matagal bago natagpuan ang lokasyon. Subukan ulit o pumili ng lugar para sa “Mula sa”.',
  'search.locateUnsupported':
    'Walang location sa device na ito. Pumili ng lugar para sa “Mula sa”.',
  'search.results': '{count} resulta',
  'search.loading': 'Naghahanap…',
  'search.offline': 'Walang signal — showing saved places',
  'search.error': 'Hindi ma-load ang search. Subukan ulit.',
  'search.idle': 'Mag-type para maghanap ng stops, landmarks, at ruta.',
  'search.noResults': 'Walang resulta para sa “{query}”.',
  'search.partialNoResults': 'Walang kumpletong resulta para sa “{query}”.',
  'search.partialNote': 'Maaaring hindi kumpleto — results may be incomplete.',
  'search.recentsHeading': 'Mga kamakailang hanap',
  'search.savedPlaces': 'Saved places',
  'search.noSavedPlaces':
    'Wala pang naka-save na lugar. I-tap ang “Saved places” para mag-imbak.',
  'group.stops': 'Stops',
  'group.landmarks': 'Landmarks',
  'group.routes': 'Routes',
  'group.saved': 'Saved',

  // --- Route options ------------------------------------------------------
  'routes.title': 'Mga ruta',
  'routes.loading': 'Naghahanap ng ruta…',
  'routes.error': 'Hindi ma-load ang mga ruta. Subukan ulit.',
  'routes.count': '{count} ruta',
  'routes.emptyStatus': 'Walang ruta',
  'routes.empty': 'Walang ruta — try a nearby landmark',
  'routes.emptyBetween': 'Walang ruta sa pagitan ng {from} at {to}',
  'routes.emptyHint': 'Subukan ang ibang starting point o magdagdag ng hintuan sa search.',
  'routes.changeStart': 'Palitan ang starting point',
  'routes.unknownPlace': 'hindi kilalang lugar',
  'routes.sortLabel': 'Ayusin ang mga ruta',
  'routes.filterRecommended': 'Recommended',
  'routes.filterCheapest': 'Cheapest',
  'routes.filterFewestTransfers': 'Fewest transfers',
  'routes.filterLessWalking': 'Less walking',
  'routes.filterLabel': 'Mga filter',
  'routes.badgeBest': 'BEST',
  'routes.badgeCheapest': 'CHEAPEST',
  'routes.badgeFewestTransfers': 'FEWEST TRANSFERS',
  'routes.badgeLeastWalking': 'LEAST WALKING',
  'routes.detail': 'Detalye',
  'routes.detailLabel': 'Detalye ng rutang {minutes} min',
  'routes.arrive': 'Dating {time}',
  'routes.direct': 'direct',
  'routes.transfers': '{count} sakay',
  'routes.walk': '{distance} lakad',
  'routes.fareLine': 'Fares: {matrix} effective {date}',
  'routes.fareMatrixLtfrb': 'LTFRB matrix',
  'routes.fareMatrixRail': 'rail fare matrix',
  'routes.fareMixed': 'mixed fare sources',
  'routes.fareNone': 'no fare',
  'routes.fareMatrixGeneric': 'fare matrix',
  'routes.modeGroup': 'Mga mode ng sakay',
  'routes.unknownMode': 'sakay ({mode})',
  'routes.sakay': 'sakay',

  // --- Mode names ---------------------------------------------------------
  'mode.walk': 'Lakad',
  'mode.jeepney': 'Jeepney',
  'mode.bus': 'Bus',
  'mode.mrt3': 'MRT-3',
  'mode.lrt1': 'LRT-1',
  'mode.lrt2': 'LRT-2',
  'mode.ferry': 'Ferry',
  'mode.uv-express': 'UV Express',
  'mode.p2p': 'P2P',

  // --- Trip detail --------------------------------------------------------
  'trip.title': 'Detalye ng biyahe',
  'trip.summaryArrive': '{minutes} min · arrive {arrival}',
  'trip.start': 'Simulan ang biyahe',
  'trip.saveFailed':
    'Hindi nai-save ang biyahe — puno o naka-off ang storage ng device. Subukan ulit.',
  'trip.saveOk': 'Nai-save ang biyahe.',
  'trip.savedRoute': 'Saved route (no live data)',
  'trip.savedSnapshot': 'Saved snapshot (no live ETA)',
  'trip.lastUpdated': 'Last updated {date}',
  'trip.savedNote': '{label} · last updated {date}',
  'trip.steps': 'Hakbang-hakbang',
  'trip.stepsLabel': 'Mga hakbang ng biyahe',
  'trip.landmark': 'Landmark: {hint}',
  'trip.landmarkFallback': 'walang landmark — use the stop name',
  'trip.walkTo': 'Maglakad papunta sa {place}',
  'trip.walkStat': 'Lakad {distance} · {minutes} min',
  'trip.transferBuffer': 'Allow 5 min transfer',
  'trip.informalTransfer': 'informal_transfer',
  'trip.rideTo': 'Sakay {route} papuntang {headsign}',
  'trip.lookFor': 'Look for: {route}',
  'trip.rideStat': '{start} – {end} · {minutes} min · {distance}',
  'trip.stopCounter': '{count} hintuan · baba sa {place}',
  'trip.showStops': 'show {count} {word}',
  'trip.hideStops': 'hide {count} {word}',
  'trip.stopWord': 'stop',
  'trip.stopsWord': 'stops',
  'trip.legLabel': '{mode} · leg {index} of {total}',
  'trip.stopsLabel': 'Mga hintuan',
  'trip.board': 'Sakayan',
  'trip.baba': 'Baba',
  'trip.passThrough': 'Daanan',
  'trip.lipat': 'Lipat',
  'trip.bayad': 'Bayad',

  // --- Trip live placeholder ---------------------------------------------
  'trip.liveTitle': 'Biyahe ngayon',
  'trip.liveBanner': 'no live data — expected wait',
  'trip.liveBody':
    'Walang real-time na datos para sa rutang ito. Asahan ang paghihintay sa sakayan at sundan ang static na timeline sa detalye ng biyahe.',
  'trip.cachedPlan': 'naka-cache na plano',
  'trip.noCached': 'Wala nang ruta sa cache. Bumalik sa search at mag-plano ulit.',

  // --- Fare breakdown -----------------------------------------------------
  'fare.empty': 'Walang bayad sa rutang ito.',
  'fare.breakdownLabel': 'Fare breakdown',
  'fare.total': 'Total ₱{amount}',
  'fare.effective': 'Effective {date}',
  'fare.source': 'Source:',

  // --- Saved / recent -----------------------------------------------------
  'saved.title': 'Mga naka-save at kamakailan',
  'saved.offlineBadge': 'Offline — saved routes only',
  'saved.tabsLabel': 'Saved at recent na biyahe',
  'saved.tabSaved': 'Saved',
  'saved.tabRecent': 'Recent',
  'saved.listLabel': 'Mga naka-save na biyahe',
  'saved.empty': 'Wala ka pang naka-save na biyahe.',
  'saved.searchCta': 'Maghanap ng ruta',
  'saved.recentNote':
    'Awtomatikong nawawala ang mga kamakailang biyahe pagkatapos ng 30 araw.',
  'saved.recentListLabel': 'Mga kamakailang biyahe',
  'saved.recentEmpty': 'Wala pang kamakailang biyahe.',
  'saved.rename': 'Palitan',
  'saved.renameLabel': 'Palitan ang pangalan ng {name}',
  'saved.deleteLabel': 'I-delete ang {name}',
  'saved.deleteReveal': 'I-delete',
  'saved.fareLine': '₱{amount} · fare effective {date}',
  'saved.changed': 'Fare may have changed since you saved this.',
  'saved.expired': 'Mahigit 30 araw na ang snapshot na ito.',
  'saved.unknownPuv': 'Hindi ma-check ang fare matrix ngayon.',
  'saved.unknownNonPuv':
    'Hindi PUV fare ang snapshot na ito, kaya hindi maihahambing sa PUV matrix.',
  'saved.currentMatrix': 'Kasalukuyang fare matrix: {date}.',
  'saved.sameMatrix': 'Pareho ang fare matrix ({date}) sa snapshot.',
  'saved.deleteFailed': 'Hindi na-delete ang biyahe. Subukan ulit.',
  'saved.deleted': 'Nai-delete ang {name}.',
  'saved.restoreFailed': 'Hindi naibalik ang biyahe. Subukan ulit.',
  'saved.restored': 'Naibalik ang biyahe.',
  'saved.renamed': 'Napalitan ang pangalan ng biyahe.',
  'saved.renameFailed': 'Hindi na-save ang pangalan.',
  'saved.renameFailedDetail': 'Hindi na-save ang pangalan. Subukan ulit.',
  'saved.renameHeading': 'Pangalan ng biyahe',
  'saved.renameSave': 'I-save ang pangalan',
  'saved.deletedToast': 'Nai-delete ang biyahe.',

  // --- UX v2: Home -------------------------------------------------------
  'home.tagline': 'Ang plano mo sa bawat biyahe.',
  'home.brandSub': 'Commute planner ng Metro Manila',
  'home.recentsHeading': 'Mga kamakailang biyahe',
  'home.recentsEmpty': 'Wala pang biyahe — simulan ang unang plano mo.',
  'home.recentsLabel': 'Mga kamakailang biyahe',
  'home.planCta': 'Mag-plano ng biyahe',

  // --- UX v2: Route options ---------------------------------------------
  'routes.tripSub': '{from} → {to} · alis {time}',
  'routes.countSummary': '{count} ruta · pinakamabilis {minutes} min',
  'routes.depart': 'alis {time}',
  'routes.legStripLabel': 'Mga bahagi ng biyahe',
  'routes.legMinutes': '{minutes} min',
  'routes.legRideLabel': '{route} · {count} hintuan',
  'routes.detailAction': 'Tingnan ang detalye',
  'routes.detailActionLabel': 'Tingnan ang detalye ng rutang {minutes} min',
  'routes.selectedAnnounce': 'Napili ang rutang {minutes} min',
  'routes.mapLabel': 'Mapa ng mga ruta',
  'routes.ribbonLabel': 'Buod ng mga hakbang',

  // --- UX v2: Trip detail -----------------------------------------------
  'trip.mapLabel': 'Mapa ng ruta',
  'trip.fareHeading': 'Bayad sa biyahe',
  'trip.heroArrive': 'dating {arrival}',
  'trip.legStripLabel': 'Pindutin ang hakbang para i-focus sa mapa',
  'trip.legFocusAnnounce': 'Hakbang {index}: {title}',
  'trip.focusWhole': 'Ipakita ang buong ruta',
  'trip.wholeRoute': 'Buong ruta',
  'trip.signageLabel': 'Hanapin',
  'trip.alightAt': 'Baba sa {place}',
  'trip.stopsShow': 'Ipakita ang {count} hintuan',
  'trip.stopsHide': 'Itago ang {count} hintuan',
  'trip.stopCount': '{count} hintuan',
  'trip.legNumber': 'Hakbang {index}',
  'trip.mapHint': 'Pindutin ang isang hakbang para makita ang ruta nito.',

  // --- UX v2: Live walkthrough ------------------------------------------
  'trip.liveProgress': 'Hakbang {index} ng {total}',
  'trip.liveHonesty': 'Gabay lamang ito batay sa nakaplanong itinerary — walang live tracking.',
  'trip.liveCurrent': 'Kasalukuyang hakbang',
  'trip.livePrev': 'Nakaraan',
  'trip.liveNext': 'Susunod',
  'trip.liveFinish': 'Tapos ang biyahe',
  'trip.liveFinishBody': 'Narating mo na ang destinasyon. Ingat sa pag-uwi!',
  'trip.liveStartOver': 'Ulitin mula sa simula',
  'trip.liveAnnounce': 'Hakbang {index} ng {total}: {title}',
  'trip.liveMapLabel': 'Mapa ng biyahe',
  'trip.liveExit': 'Bumalik sa detalye',

  // --- UX v2: Saved ------------------------------------------------------
  'saved.titleLabel': '{from} → {to}',
  'saved.savedOn': 'Na-save noong {date}',
  'saved.recentOn': 'Huling binuksan {date}',
  'saved.legStripLabel': 'Mga bahagi ng biyahe',

  // --- UX v2: Map --------------------------------------------------------
  'map.routeCount': '{count} ruta sa mapa',
  'map.routeLegendSelected': 'Piniling ruta',
  'map.routeLegendOther': 'Ibang ruta',

  // --- About data (provenance) -------------------------------------------
  'about.title': 'Pinagmulan ng datos',
  'about.subtitle': 'Saan galing ang bawat datos, at ano ang lisensya nito.',
  'about.loading': 'Nilo-load ang mga pinagmulan ng datos…',
  'about.error': 'Hindi ma-load ang mga pinagmulan ng datos. Subukan ulit.',
  'about.errorNetwork': 'Walang koneksyon. Hindi ma-load ang mga pinagmulan ng datos.',
  'about.count': '{count} na dataset',
  'about.datasetsLabel': 'Mga dataset',
  'about.publisher': 'Tagapaglathala',
  'about.licence': 'Lisensya',
  'about.lastChecked': 'Huling tsek',
  'about.coverage': 'Saklaw',
  'about.confidence': 'Kumpiyansa',
  'about.confidenceUnpublished': 'hindi naka-publish',
  'about.openDetail': 'Buksan ang detalye',
  'about.sheetKicker': 'Lisensya at pinagmulan',
  'about.licenceHeading': 'Lisensya',
  'about.spdx': 'SPDX: {id}',
  'about.sourceHeading': 'Source',
  'about.sourceMeta': '{coverage} · huling tsek {date}',
  'about.attributionHeading': 'Attribution',
  'about.reportHeading': 'I-report ang isyu',
  'about.reportLink': 'Mag-report ng isyu sa dataset na ito',
  'about.reportUnconfigured':
    'Wala pang naka-configure na report link. Hindi pa live ang pag-report (phase 4) — huwag mag-imbento ng isyu.',

  // --- Provenance chip ----------------------------------------------------
  'provenance.missingSource': 'source unavailable',
  'provenance.dataSources': 'Data sources',

  // --- Map ----------------------------------------------------------------
  'map.region': 'Mapa ng ruta',
  'map.placeholder': 'Mapa',
  'map.locate': 'Hanapin ang lokasyon ko',
  'map.locating': 'Hinahanap ang lokasyon mo…',
  'map.located': 'Nakita ang lokasyon mo.',
  'map.denied': 'Hindi ma-access ang lokasyon. Pindutin ang mapa para maglagay ng pin.',
  'map.unavailable':
    'Hindi available ang lokasyon sa device na ito. Pindutin ang mapa para maglagay ng pin.',
  'map.timeout':
    'Matagal bago natagpuan ang lokasyon. Pindutin ang mapa para maglagay ng pin.',
  'map.pinned': 'Nakalagay na ang pin. Pindutin muli ang lokasyon para subukan ulit.',
  'map.creditKicker': 'Mga pinagmulan ng data',
  'map.creditEmpty': 'OpenFreeMap tiles, © OpenMapTiles · Data from OpenStreetMap.',

  // --- Bottom sheet -------------------------------------------------------
  'sheet.expand': 'Expand sheet',
  'sheet.collapse': 'Collapse sheet',
  'sheet.tripDetails': 'Detalye ng biyahe',

  // --- /plan route notices ------------------------------------------------
  'plan.sheetLabel': 'Mga ruta',
  'plan.originCurrent': 'Kasalukuyang lokasyon',
  'plan.locatingTitle': 'Naghahanap ng starting point',
  'plan.locatingStatus': 'Hinahanap ang lokasyon mo…',
  'plan.backToSearch': 'Bumalik sa search',
  'plan.originDeniedTitle': 'Hindi pinayagan ang lokasyon',
  'plan.originDeniedMessage':
    'Kailangan ng starting point para makapag-plano ng ruta. Payagan ang location sa browser, o pumili ng destinasyon mula sa search.',
  'plan.originTimeoutTitle': 'Matagal bago natagpuan ang lokasyon',
  'plan.originTimeoutMessage':
    'Kailangan ng starting point para makapag-plano ng ruta. Subukan ulit, o pumili ng destinasyon mula sa search.',
  'plan.originUnavailableTitle': 'Hindi available ang lokasyon',
  'plan.originUnavailableMessage':
    'Hindi available ang lokasyon sa device na ito. Kailangan ng starting point para makapag-plano — pumili ng destinasyon mula sa search.',
  'plan.originUnsupportedTitle': 'Walang location sa device na ito',
  'plan.originUnsupportedMessage':
    'Hindi sinusuportahan ng browser ang location. Kailangan ng starting point para makapag-plano — pumili ng destinasyon mula sa search.',
  'plan.missingDestTitle': 'Walang destinasyon',
  'plan.missingDestMessage':
    'Walang valid na destinasyon sa link. Pumili muna ng lugar sa search.',
  'plan.findPlace': 'Maghanap ng lugar',
  'plan.badOriginTitle': 'Hindi valid ang starting point',
  'plan.badOriginMessage':
    'Hindi mabasa ang starting point sa link. Bumalik sa search at pumili ulit.',
  'plan.noRouteTitle': 'Wala nang ruta',
  'plan.noIdMessage': 'Walang itinerary id sa link. Bumalik sa search at mag-plano ulit.',
  'plan.expiredMessage':
    'Hindi na available ang plan na ito sa device. Bumalik sa search at mag-plano ulit.',
} as const;

type StringKey = keyof typeof TL;

/**
 * English fallback. Typed as `Record<StringKey, string>` so a missing or
 * misspelled key fails `tsc`, not a runtime lookup.
 */
const EN: Record<StringKey, string> = {
  'common.back': 'Back',
  'common.retry': 'Try again',
  'common.cancel': 'Cancel',
  'common.close': 'Close',
  'common.save': 'Save',
  'common.saved': 'Saved',
  'common.delete': 'Delete',
  'common.open': 'Open',
  'common.undo': 'Undo',
  'common.fare': 'Fare',
  'common.estimate': 'Estimate',
  'common.aboutData': 'About data',
  'common.dataSources': 'Data sources',
  'common.offline': 'Offline',
  'common.loading': 'Loading…',

  'home.sheetLabel': 'Home',
  'home.eyebrow': 'Trip planning',
  'home.brand': 'BiyaHey!',
  'home.hint': 'Drag the sheet up to plan a route.',
  'home.saved': 'Saved and recent',

  'search.placeholder': 'Where are you going?',
  'search.label': 'Search for a place',
  'search.heading': 'Where to?',
  'search.clear': 'Clear search',
  'search.title': 'Plan a trip',
  'search.fromLabel': 'From',
  'search.toLabel': 'To',
  'search.fromPlaceholder': 'Where are you coming from?',
  'search.stopPlaceholder': 'Where will you stop?',
  'search.stopLabel': 'Stop {index}',
  'search.addStop': 'Add a stop',
  'search.removeStop': 'Remove stop',
  'search.removeStopIndex': 'Remove stop {index}',
  'search.swap': 'Swap from and to',
  'search.useMyLocation': 'Use my location',
  'search.findRoute': 'Find a route',
  'search.noStops': 'No stops found for “{query}”.',
  'search.partialNoStops': 'No complete stops found for “{query}”.',
  'search.locateDenied':
    'Location was not allowed. Pick a place for “From” or try again.',
  'search.locateUnavailable':
    "Location isn't available on this device. Pick a place for “From”.",
  'search.locateTimeout':
    'Finding the location took too long. Try again or pick a place for “From”.',
  'search.locateUnsupported':
    "This device has no location. Pick a place for “From”.",
  'search.results': '{count} result(s)',
  'search.loading': 'Searching…',
  'search.offline': 'No signal — showing saved places',
  'search.error': "Couldn't load search. Try again.",
  'search.idle': 'Type to search stops, landmarks and routes.',
  'search.noResults': 'No results for “{query}”.',
  'search.partialNoResults': 'No complete results for “{query}”.',
  'search.partialNote': 'Results may be incomplete.',
  'search.recentsHeading': 'Recent searches',
  'search.savedPlaces': 'Saved places',
  'search.noSavedPlaces': 'No saved places yet. Tap “Saved places” to store one.',
  'group.stops': 'Stops',
  'group.landmarks': 'Landmarks',
  'group.routes': 'Routes',
  'group.saved': 'Saved',

  'routes.title': 'Routes',
  'routes.loading': 'Finding routes…',
  'routes.error': "Couldn't load routes. Try again.",
  'routes.count': '{count} routes',
  'routes.emptyStatus': 'No routes',
  'routes.empty': 'No route — try a nearby landmark',
  'routes.emptyBetween': 'No route between {from} and {to}',
  'routes.emptyHint': 'Try a different starting point or add a stop in search.',
  'routes.changeStart': 'Change the starting point',
  'routes.unknownPlace': 'unknown place',
  'routes.sortLabel': 'Sort routes',
  'routes.filterRecommended': 'Recommended',
  'routes.filterCheapest': 'Cheapest',
  'routes.filterFewestTransfers': 'Fewest transfers',
  'routes.filterLessWalking': 'Less walking',
  'routes.filterLabel': 'Filters',
  'routes.badgeBest': 'BEST',
  'routes.badgeCheapest': 'CHEAPEST',
  'routes.badgeFewestTransfers': 'FEWEST TRANSFERS',
  'routes.badgeLeastWalking': 'LEAST WALKING',
  'routes.detail': 'Details',
  'routes.detailLabel': 'Details for the {minutes}-minute route',
  'routes.arrive': 'Arrive {time}',
  'routes.direct': 'direct',
  'routes.transfers': '{count} rides',
  'routes.walk': '{distance} walk',
  'routes.fareLine': 'Fares: {matrix} effective {date}',
  'routes.fareMatrixLtfrb': 'LTFRB matrix',
  'routes.fareMatrixRail': 'rail fare matrix',
  'routes.fareMixed': 'mixed fare sources',
  'routes.fareNone': 'no fare',
  'routes.fareMatrixGeneric': 'fare matrix',
  'routes.modeGroup': 'Travel modes',
  'routes.unknownMode': 'ride ({mode})',
  'routes.sakay': 'ride',

  'mode.walk': 'Walk',
  'mode.jeepney': 'Jeepney',
  'mode.bus': 'Bus',
  'mode.mrt3': 'MRT-3',
  'mode.lrt1': 'LRT-1',
  'mode.lrt2': 'LRT-2',
  'mode.ferry': 'Ferry',
  'mode.uv-express': 'UV Express',
  'mode.p2p': 'P2P',

  'trip.title': 'Trip details',
  'trip.summaryArrive': '{minutes} min · arrive {arrival}',
  'trip.start': 'Start trip',
  'trip.saveFailed': "Couldn't save the trip — device storage is full or off. Try again.",
  'trip.saveOk': 'Trip saved.',
  'trip.savedRoute': 'Saved route (no live data)',
  'trip.savedSnapshot': 'Saved snapshot (no live ETA)',
  'trip.lastUpdated': 'Last updated {date}',
  'trip.savedNote': '{label} · last updated {date}',
  'trip.steps': 'Step by step',
  'trip.stepsLabel': 'Trip steps',
  'trip.landmark': 'Landmark: {hint}',
  'trip.landmarkFallback': 'no landmark — use the stop name',
  'trip.walkTo': 'Walk to {place}',
  'trip.walkStat': 'Walk {distance} · {minutes} min',
  'trip.transferBuffer': 'Allow 5 min transfer',
  'trip.informalTransfer': 'informal_transfer',
  'trip.rideTo': 'Ride {route} to {headsign}',
  'trip.lookFor': 'Look for: {route}',
  'trip.rideStat': '{start} – {end} · {minutes} min · {distance}',
  'trip.stopCounter': '{count} stops · alight at {place}',
  'trip.showStops': 'show {count} {word}',
  'trip.hideStops': 'hide {count} {word}',
  'trip.stopWord': 'stop',
  'trip.stopsWord': 'stops',
  'trip.legLabel': '{mode} · leg {index} of {total}',
  'trip.stopsLabel': 'Stops',
  'trip.board': 'Board',
  'trip.baba': 'Alight',
  'trip.passThrough': 'Pass through',
  'trip.lipat': 'Transfer',
  'trip.bayad': 'Fare',

  'trip.liveTitle': 'Trip status',
  'trip.liveBanner': 'no live data — expected wait',
  'trip.liveBody':
    'No real-time data for this route. Expect a wait at the stop and follow the static timeline in the trip details.',
  'trip.cachedPlan': 'cached plan',
  'trip.noCached': 'No route left in the cache. Go back to search and plan again.',

  'fare.empty': 'No fare on this route.',
  'fare.breakdownLabel': 'Fare breakdown',
  'fare.total': 'Total ₱{amount}',
  'fare.effective': 'Effective {date}',
  'fare.source': 'Source:',

  'saved.title': 'Saved and recent',
  'saved.offlineBadge': 'Offline — saved routes only',
  'saved.tabsLabel': 'Saved and recent trips',
  'saved.tabSaved': 'Saved',
  'saved.tabRecent': 'Recent',
  'saved.listLabel': 'Saved trips',
  'saved.empty': 'You have no saved trips yet.',
  'saved.searchCta': 'Find a route',
  'saved.recentNote': 'Recent trips expire automatically after 30 days.',
  'saved.recentListLabel': 'Recent trips',
  'saved.recentEmpty': 'No recent trips yet.',
  'saved.rename': 'Rename',
  'saved.renameLabel': 'Rename {name}',
  'saved.deleteLabel': 'Delete {name}',
  'saved.deleteReveal': 'Delete',
  'saved.fareLine': '₱{amount} · fare effective {date}',
  'saved.changed': 'Fare may have changed since you saved this.',
  'saved.expired': 'This snapshot is over 30 days old.',
  'saved.unknownPuv': "Can't check the fare matrix right now.",
  'saved.unknownNonPuv':
    "This snapshot isn't a PUV fare, so it can't be compared with the PUV matrix.",
  'saved.currentMatrix': 'Current fare matrix: {date}.',
  'saved.sameMatrix': 'Same fare matrix ({date}) as the snapshot.',
  'saved.deleteFailed': "Couldn't delete the trip. Try again.",
  'saved.deleted': 'Deleted {name}.',
  'saved.restoreFailed': "Couldn't restore the trip. Try again.",
  'saved.restored': 'Trip restored.',
  'saved.renamed': 'Trip renamed.',
  'saved.renameFailed': "Couldn't save the name.",
  'saved.renameFailedDetail': "Couldn't save the name. Try again.",
  'saved.renameHeading': 'Trip name',
  'saved.renameSave': 'Save name',
  'saved.deletedToast': 'Trip deleted.',

  'home.tagline': 'Your plan for every commute.',
  'home.brandSub': 'Metro Manila commute planner',
  'home.recentsHeading': 'Recent trips',
  'home.recentsEmpty': 'No trips yet — plan your first one.',
  'home.recentsLabel': 'Recent trips',
  'home.planCta': 'Plan a trip',

  'routes.tripSub': '{from} → {to} · departs {time}',
  'routes.countSummary': '{count} routes · fastest {minutes} min',
  'routes.depart': 'departs {time}',
  'routes.legStripLabel': 'Trip legs',
  'routes.legMinutes': '{minutes} min',
  'routes.legRideLabel': '{route} · {count} stops',
  'routes.detailAction': 'View details',
  'routes.detailActionLabel': 'View details for the {minutes}-minute route',
  'routes.selectedAnnounce': 'Selected the {minutes}-minute route',
  'routes.mapLabel': 'Routes map',
  'routes.ribbonLabel': 'Step summary',

  'trip.mapLabel': 'Route map',
  'trip.fareHeading': 'Trip fare',
  'trip.heroArrive': 'arrive {arrival}',
  'trip.legStripLabel': 'Press a step to focus it on the map',
  'trip.legFocusAnnounce': 'Step {index}: {title}',
  'trip.focusWhole': 'Show the whole route',
  'trip.wholeRoute': 'Whole route',
  'trip.signageLabel': 'Look for',
  'trip.alightAt': 'Alight at {place}',
  'trip.stopsShow': 'Show {count} stops',
  'trip.stopsHide': 'Hide {count} stops',
  'trip.stopCount': '{count} stops',
  'trip.legNumber': 'Step {index}',
  'trip.mapHint': 'Press a step to see its route.',

  'trip.liveProgress': 'Step {index} of {total}',
  'trip.liveHonesty': 'This is a guide based on the planned itinerary — no live tracking.',
  'trip.liveCurrent': 'Current step',
  'trip.livePrev': 'Previous',
  'trip.liveNext': 'Next',
  'trip.liveFinish': 'Trip complete',
  'trip.liveFinishBody': 'You have reached your destination. Take care!',
  'trip.liveStartOver': 'Start over from the beginning',
  'trip.liveAnnounce': 'Step {index} of {total}: {title}',
  'trip.liveMapLabel': 'Trip map',
  'trip.liveExit': 'Back to details',

  'saved.titleLabel': '{from} → {to}',
  'saved.savedOn': 'Saved on {date}',
  'saved.recentOn': 'Last opened {date}',
  'saved.legStripLabel': 'Trip legs',

  'map.routeCount': '{count} routes on the map',
  'map.routeLegendSelected': 'Selected route',
  'map.routeLegendOther': 'Other route',

  'about.title': 'Data sources',
  'about.subtitle': 'Where each dataset comes from and what its licence is.',
  'about.loading': 'Loading data sources…',
  'about.error': "Couldn't load data sources. Try again.",
  'about.errorNetwork': "No connection. Couldn't load data sources.",
  'about.count': '{count} datasets',
  'about.datasetsLabel': 'Datasets',
  'about.publisher': 'Publisher',
  'about.licence': 'Licence',
  'about.lastChecked': 'Last checked',
  'about.coverage': 'Coverage',
  'about.confidence': 'Confidence',
  'about.confidenceUnpublished': 'not published',
  'about.openDetail': 'Open details',
  'about.sheetKicker': 'Licence and source',
  'about.licenceHeading': 'Licence',
  'about.spdx': 'SPDX: {id}',
  'about.sourceHeading': 'Source',
  'about.sourceMeta': '{coverage} · last checked {date}',
  'about.attributionHeading': 'Attribution',
  'about.reportHeading': 'Report an issue',
  'about.reportLink': 'Report an issue with this dataset',
  'about.reportUnconfigured':
    "No report link configured yet. Reporting isn't live (phase 4) — don't invent an issue.",

  'provenance.missingSource': 'source unavailable',
  'provenance.dataSources': 'Data sources',

  'map.region': 'Route map',
  'map.placeholder': 'Map',
  'map.locate': 'Find my location',
  'map.locating': 'Finding your location…',
  'map.located': 'Found your location.',
  'map.denied': "Can't access location. Tap the map to drop a pin.",
  'map.unavailable': "Location isn't available on this device. Tap the map to drop a pin.",
  'map.timeout': 'Finding the location took too long. Tap the map to drop a pin.',
  'map.pinned': 'Pin placed. Tap the location button to try again.',
  'map.creditKicker': 'Data sources',
  'map.creditEmpty': 'OpenFreeMap tiles, © OpenMapTiles · Data from OpenStreetMap.',

  'sheet.expand': 'Expand sheet',
  'sheet.collapse': 'Collapse sheet',
  'sheet.tripDetails': 'Trip details',

  'plan.sheetLabel': 'Routes',
  'plan.originCurrent': 'Current location',
  'plan.locatingTitle': 'Finding a starting point',
  'plan.locatingStatus': 'Finding your location…',
  'plan.backToSearch': 'Back to search',
  'plan.originDeniedTitle': 'Location not allowed',
  'plan.originDeniedMessage':
    'A starting point is needed to plan a route. Allow location in the browser, or pick a destination from search.',
  'plan.originTimeoutTitle': 'Finding the location took too long',
  'plan.originTimeoutMessage':
    'A starting point is needed to plan a route. Try again, or pick a destination from search.',
  'plan.originUnavailableTitle': 'Location unavailable',
  'plan.originUnavailableMessage':
    'Location is not available on this device. A starting point is needed to plan — pick a destination from search.',
  'plan.originUnsupportedTitle': 'No location on this device',
  'plan.originUnsupportedMessage':
    'This browser does not support location. A starting point is needed to plan — pick a destination from search.',
  'plan.missingDestTitle': 'No destination',
  'plan.missingDestMessage':
    'The link has no valid destination. Pick a place in search first.',
  'plan.findPlace': 'Find a place',
  'plan.badOriginTitle': 'Invalid starting point',
  'plan.badOriginMessage':
    "The link's starting point cannot be read. Go back to search and pick again.",
  'plan.noRouteTitle': 'No route available',
  'plan.noIdMessage': 'The link has no itinerary id. Go back to search and plan again.',
  'plan.expiredMessage':
    'This plan is no longer available on the device. Go back to search and plan again.',
};

/**
 * Every locale's strings. `tl` is the default (R44); `en` is complete.
 * The plan's interface requires this exact shape.
 */
export const STRINGS: Record<Locale, Record<string, string>> = { tl: TL, en: EN };

/** Default UI locale (R44). There is no locale-switch UI in v1 — see task 9 report. */
export const DEFAULT_LOCALE: Locale = 'tl';

export function isLocale(value: unknown): value is Locale {
  return value === 'tl' || value === 'en';
}

function fill(template: string, vars?: StringVars): string {
  if (vars === undefined) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (placeholder, name: string) => {
    const value = vars[name];
    return value === undefined ? placeholder : String(value);
  });
}

/**
 * Look `key` up in `locale`, falling back to `tl` and finally to the key
 * itself. A missing key is a bug the coverage test catches; returning the key
 * keeps a render from throwing in production.
 */
export function translate(locale: Locale, key: string, vars?: StringVars): string {
  const template = STRINGS[locale][key] ?? STRINGS[DEFAULT_LOCALE][key] ?? key;
  return fill(template, vars);
}

/** Translate bound to the default locale, for pure helpers and module constants. */
export const defaultT: Translate = (key, vars) => translate(DEFAULT_LOCALE, key, vars);

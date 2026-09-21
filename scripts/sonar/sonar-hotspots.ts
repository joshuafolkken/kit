// The Step B disposition for each SonarCloud hotspot on a pull request, computed rather than read by
// eye (joshuafolkken/kit#2182).
//
// `prompts/sonar-hotspot-handling.md` carried Step A and Step B as prose: the reader built the API
// URL by hand and then walked a decision table whose one mechanical branch key — "is this path
// upstream-synced?" — is already answered by `josh sync:scope`. This module is the conversion the
// table describes, so the only judgement left in prose is "is a TO_REVIEW hotspot really a false
// positive?".
//
// The upstream-synced axis is not re-derived here. The CLI passes an `is_managed` predicate built on
// `managed_config_scope.has_managed_path` — the same detection `josh sync:scope` runs — so no
// distribution path list is copied into this file.

// A hotspot needing review is a candidate suppression: on an upstream-synced path the suppression
// belongs in `sonar-project.properties` (`excluded`), on project-local code it is a local ignore
// (`local`). A hotspot SonarCloud has already reviewed carries its own resolution — a fixed one
// records a real issue (`fix`), any other resolved state is set aside (`defer`).
const EXCLUDED_BRANCH = 'excluded'
const LOCAL_BRANCH = 'local'
const FIX_BRANCH = 'fix'
const DEFER_BRANCH = 'defer'

// The fetch could not be read at all — rate-limited, offline, or a non-OK response. Named alongside
// the four branches so a caller cannot mistake a failed read for "no hotspots" (an empty success).
const UNREADABLE = 'unreadable'

const HOTSPOT_BRANCHES = [EXCLUDED_BRANCH, LOCAL_BRANCH, FIX_BRANCH, DEFER_BRANCH] as const

type HotspotBranch = (typeof HOTSPOT_BRANCHES)[number]

const TO_REVIEW_STATUS = 'TO_REVIEW'
const FIXED_RESOLUTION = 'FIXED'

// One hotspot as the public search API returns it. `component` is the SonarCloud component key
// (`<projectKey>:<path>`), not a bare path, so `component_path` strips the prefix before the managed
// check reads it.
// The optional fields carry `| undefined` explicitly: under `exactOptionalPropertyTypes` that is what
// lets the zod-parsed shape (`z.number().optional()` → `number | undefined`) assign to this type.
interface Hotspot {
	key: string
	status: string
	component: string
	line?: number | undefined
	ruleKey: string
	resolution?: string | undefined
}

// The fetch outcome: the hotspots on success, or the reason the read failed. A discriminated union so
// the unreadable case is a value the caller handles, never an empty array it silently treats as clean.
type HotspotFetch = { hotspots: ReadonlyArray<Hotspot> } | { error: string }

interface ClassifiedHotspot {
	hotspot: Hotspot
	branch: HotspotBranch
}

// The result of converting a whole fetch: one classified hotspot per entry, or the unreadable marker
// carrying the failure reason.
type HotspotDisposition = { classified: ReadonlyArray<ClassifiedHotspot> } | { unreadable: string }

// The repository-root-relative path a managed check reads. A SonarCloud component key is
// `<projectKey>:<path>`; a key with no colon (some API shapes) is already the path.
function component_path(component: string): string {
	const separator_index = component.indexOf(':')

	return separator_index === -1 ? component : component.slice(separator_index + 1)
}

function classify_hotspot(hotspot: Hotspot, is_managed: boolean): HotspotBranch {
	if (hotspot.status === TO_REVIEW_STATUS) return is_managed ? EXCLUDED_BRANCH : LOCAL_BRANCH

	return hotspot.resolution === FIXED_RESOLUTION ? FIX_BRANCH : DEFER_BRANCH
}

function classify_one(
	hotspot: Hotspot,
	is_managed: (component: string) => boolean,
): ClassifiedHotspot {
	return { hotspot, branch: classify_hotspot(hotspot, is_managed(hotspot.component)) }
}

// The conversion the whole command exists to perform: a fetch outcome becomes either a disposition
// per hotspot or the unreadable marker. `is_managed` answers the upstream-synced axis for a component
// key — the CLI builds it on `sync:scope`'s own detection.
function classify_fetch(
	fetch: HotspotFetch,
	is_managed: (component: string) => boolean,
): HotspotDisposition {
	if ('error' in fetch) return { unreadable: fetch.error }

	return { classified: fetch.hotspots.map((hotspot) => classify_one(hotspot, is_managed)) }
}

const sonar_hotspots = {
	classify_fetch,
	classify_hotspot,
	component_path,
	HOTSPOT_BRANCHES,
	UNREADABLE,
}

export {
	sonar_hotspots,
	EXCLUDED_BRANCH,
	LOCAL_BRANCH,
	FIX_BRANCH,
	DEFER_BRANCH,
	UNREADABLE,
	HOTSPOT_BRANCHES,
}
export type { ClassifiedHotspot, Hotspot, HotspotBranch, HotspotDisposition, HotspotFetch }

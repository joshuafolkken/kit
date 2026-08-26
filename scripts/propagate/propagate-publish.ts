import { with_page_size } from '#scripts/version/version-remote'
import { execaSync } from 'execa'

// Waiting for a specific version of this package to actually exist in the registry.
//
// A merge is not a publish: kit's auto-tag and publish workflows run after the merge commit lands,
// so a consumer told to upgrade the instant the PR merged resolves the previous release. The wait is
// implemented once here because joshuafolkken/kit#864 resolves a cross-repository child on the same
// condition — two implementations would drift, and the looser one would decide
// (joshuafolkken/kit#863).

const VERSIONS_PAGE_SIZE = 100
const NAMES_JQ = '[.[] | .name]'
const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_INTERVAL_MS = 15_000
const GH_TIMEOUT_MS = 20_000
// How many probes in a row may fail before the registry is called unreadable. One failure is a rate
// limit, a 5xx or a DNS hiccup — ending a ten-minute wait seconds in, on the first of those, is the
// opposite of waiting. Only a registry that fails this many times running is a broken one.
const UNREADABLE_THRESHOLD = 3

// How a wait ended. `timed_out` is deliberately distinct from `published`: a publish workflow that
// failed never produces the version, and reporting that as anything other than an anomaly would let
// propagation continue against a release that does not exist.
type PublishWaitState = 'published' | 'timed_out' | 'unreadable'

interface PublishWaitResult {
	state: PublishWaitState
	version: string
	attempts: number
	detail?: string
}

// Whether the target version is among the versions the registry reports. Exact membership, never
// "something newer exists": a consumer several releases behind would otherwise be satisfied by any
// publish at all, including one that predates the change being propagated.
function is_version_published(
	published_versions: ReadonlyArray<string>,
	target_version: string,
): boolean {
	return published_versions.includes(target_version)
}

// Whether the wait should keep going. Split out so the loop below stays a loop over a decision
// rather than a decision spread across a loop.
function should_keep_waiting(now_ms: number, deadline_ms: number): boolean {
	return now_ms < deadline_ms
}

function finish(state: PublishWaitState, version: string, attempts: number): PublishWaitResult {
	return { state, version, attempts }
}

// The versions the registry reports for this package, or nothing when it could not be read. An
// unreadable registry is never treated as "not published yet" past the timeout — the two are
// reported apart, because one means wait longer and the other means something is broken.
function fetch_published_versions(versions_endpoint: string): Array<string> | undefined {
	const endpoint = with_page_size(versions_endpoint, VERSIONS_PAGE_SIZE)
	const result = execaSync('gh', ['api', endpoint, '--jq', NAMES_JQ], {
		reject: false,
		timeout: GH_TIMEOUT_MS,
	})
	if (result.exitCode !== 0) return undefined

	try {
		const parsed: unknown = JSON.parse(result.stdout)

		return Array.isArray(parsed) ? parsed.filter((name) => typeof name === 'string') : undefined
	} catch {
		return undefined
	}
}

// The knobs the wait exposes. Every one of them is injectable so the unit suite can drive the loop
// without a registry, a clock, or a real delay.
interface WaitOptions {
	timeout_ms?: number
	interval_ms?: number
	fetch_versions?: (endpoint: string) => Array<string> | undefined
	sleep?: (milliseconds: number) => Promise<void>
	now?: () => number
}

interface ResolvedWait {
	timeout_ms: number
	interval_ms: number
	fetch_versions: (endpoint: string) => Array<string> | undefined
	sleep: (milliseconds: number) => Promise<void>
	now: () => number
}

async function real_sleep(milliseconds: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, milliseconds)
	})
}

const WAIT_DEFAULTS: ResolvedWait = {
	timeout_ms: DEFAULT_TIMEOUT_MS,
	interval_ms: DEFAULT_INTERVAL_MS,
	fetch_versions: fetch_published_versions,
	sleep: real_sleep,
	now: Date.now,
}

// Spread rather than a chain of `??`, so adding a knob does not add a branch to a function the
// complexity limit already caps.
function resolve_wait_options(options: WaitOptions): ResolvedWait {
	return { ...WAIT_DEFAULTS, ...options }
}

// The outcome of one probe: found, still waiting, or the registry has now failed often enough in a
// row to call it unreadable.
function probe_state(
	versions: ReadonlyArray<string> | undefined,
	target_version: string,
	consecutive_failures: number,
): PublishWaitState | undefined {
	if (versions === undefined) {
		return consecutive_failures >= UNREADABLE_THRESHOLD ? 'unreadable' : undefined
	}

	return is_version_published(versions, target_version) ? 'published' : undefined
}

// Poll until the target version exists, the timeout elapses, or the registry proves unreadable.
//
// A registry that keeps failing ends the wait rather than being retried to the timeout: `gh` failing
// is a different problem from a publish still running, and propagating on a guess is what must not
// happen. A single failure is not that — see `UNREADABLE_THRESHOLD`. Either way the caller reports
// it and touches no consumer.
// What the loop carries between probes: how many it has made, and how many failed in a row.
interface WaitProgress {
	attempts: number
	failures: number
}

// One probe, advancing the progress it was given. Mutating it here rather than returning a new one
// keeps the loop above within its statement budget.
function probe_once(
	resolved: ResolvedWait,
	versions_endpoint: string,
	target_version: string,
	progress: WaitProgress,
): { state?: PublishWaitState } {
	progress.attempts += 1
	const versions = resolved.fetch_versions(versions_endpoint)

	progress.failures = versions === undefined ? progress.failures + 1 : 0
	const state = probe_state(versions, target_version, progress.failures)

	return state === undefined ? {} : { state }
}

async function wait_for_publish(
	versions_endpoint: string,
	target_version: string,
	options: WaitOptions = {},
): Promise<PublishWaitResult> {
	const resolved = resolve_wait_options(options)
	const deadline = resolved.now() + resolved.timeout_ms
	const progress: WaitProgress = { attempts: 0, failures: 0 }

	while (should_keep_waiting(resolved.now(), deadline)) {
		const { state } = probe_once(resolved, versions_endpoint, target_version, progress)

		if (state !== undefined) return finish(state, target_version, progress.attempts)
		await resolved.sleep(resolved.interval_ms)
	}

	return finish('timed_out', target_version, progress.attempts)
}

const propagate_publish = {
	DEFAULT_TIMEOUT_MS,
	DEFAULT_INTERVAL_MS,
	UNREADABLE_THRESHOLD,
	is_version_published,
	should_keep_waiting,
	fetch_published_versions,
	wait_for_publish,
}

export type { PublishWaitResult, PublishWaitState, WaitOptions }
export { propagate_publish }

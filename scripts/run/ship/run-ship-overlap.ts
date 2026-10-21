import { changed_paths } from '#scripts/git/changed-paths'
import { git_diff_reads } from '#scripts/git/git-diff-reads'
import { git_merge_conflicts } from '#scripts/git/git-merge-conflicts'
import { git_spawn } from '#scripts/git/git-spawn'
import { main_merge_regenerate } from '#scripts/git/main-merge-regenerate'
import { session_cite } from '#scripts/issue/session-cite'
import { lane_handoff } from '#scripts/lane/lane-handoff'
import { lane_ledger, type OverlapRecord } from '#scripts/lane/lane-ledger'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { poll } from '#scripts/lib/poll'

// The wait in front of `josh ship`'s sync (joshuafolkken/kit#3901). `backlog-overlap.ts` keeps lanes
// apart only on the paths their issue bodies declare, so two lanes that both edit an undeclared file
// were found out only when the later pull request turned `DIRTY` — after its gate and its CI wait,
// often as a `conflict` stop its child no longer had the context for.
//
// **The later ship waits for the earlier one rather than anything being pushed into a lane.** A lane
// whose actual change conflicts with this one's and whose pull request is already open (its branch pushed,
// its detached ship still running) is waited on until that ship ends, merged or stopped; the sync that
// follows then merges a default branch that already holds it, so a conflict surfaces before this
// lane's gate rather than after its CI. Merging into the other lane's tree instead could not work: a
// lane mid-gate would have its record moved under it, and a lane still implementing holds the
// overlapping paths uncommitted, which `main:merge`'s guard refuses.
//
// **Only a ship launched before this one is waited on**, so two ships never wait on each other — a
// re-ship after a stop already has a pushed branch, so "pushed" alone could not order two re-ships in
// their sync. A ship run in an agent's own turn has no launch record and counts as the latest; equal
// launch times fall to the lower issue number. The wait is bounded — a ship that hangs never holds
// another past `MAX_WAIT_ATTEMPTS`, after which the sync goes ahead as it always did.

const WAIT_INTERVAL_MS = 30_000
const MAX_WAIT_ATTEMPTS = 60
// Unquoted like `read_changed_paths`, so a non-ASCII path compares equal on both sides.
const NAME_ONLY_ARGUMENTS = [
	'-c',
	'core.quotePath=false',
	'diff',
	'--name-only',
	'--no-relative',
	'--no-renames',
]
const REGENERATED_PATHS: ReadonlySet<string> = new Set(
	main_merge_regenerate.REGENERATED_FILES.map((entry) => entry.path),
)

interface OverlapOptions {
	sleeper?: (duration_ms: number) => Promise<void>
	ledger?: string
}

interface Overlap {
	lanes: ReadonlyArray<LaneInfo>
	paths: ReadonlyArray<string>
}

function to_paths(raw: string): Array<string> {
	return changed_paths.to_paths(raw)
}

async function has_upstream(directory: string): Promise<boolean> {
	try {
		await git_spawn.read(['-C', directory, 'rev-parse', '--verify', '--quiet', '@{upstream}'])

		return true
	} catch {
		return false
	}
}

// A lane's change as its pushed branch carries it: everything its commits changed since it left the
// default branch. Read in its own tree, so the other lane's uncommitted edits — not yet on its pull
// request — are not counted.
async function lane_paths(directory: string): Promise<ReadonlyArray<string>> {
	const base = await git_diff_reads.default_branch_reference()

	try {
		return to_paths(
			await git_spawn.read(['-C', directory, ...NAME_ONLY_ARGUMENTS, `${base}...HEAD`, '--']),
		)
	} catch {
		return []
	}
}

interface Launch {
	issue: string
	since: number
}

function own_launch(issue: string): Launch {
	const since = lane_handoff.ship_running_since(issue, process.cwd())

	return { issue, since: since ?? Infinity }
}

function is_launched_before(lane: LaneInfo, own: Launch): boolean {
	const since = lane_handoff.ship_running_since(lane.issue, lane.directory)

	if (since === undefined) return false

	return since < own.since || (since === own.since && Number(lane.issue) < Number(own.issue))
}

async function is_open_ship(lane: LaneInfo, own: Launch): Promise<boolean> {
	if (!is_launched_before(lane, own)) return false

	return await has_upstream(lane.directory)
}

async function lane_head(directory: string): Promise<string | undefined> {
	try {
		return await git_spawn.read(['-C', directory, 'rev-parse', 'HEAD'])
	} catch {
		return undefined
	}
}

// Of the paths both lanes change, the ones merging the other lane's head into this lane's working
// tree would actually stop on (joshuafolkken/kit#4348) — the working tree, since this lane's change is
// not committed until after the sync: an identical addition merges cleanly, so only a real conflict
// is waited on. Only a shared path is tried: a lane forked from an older default branch also
// conflicts on files the default branch changed since, which this lane's sync takes from the default
// branch, not from that lane. A file `main:merge` regenerates is resolved by the sync either way, so
// it never counts. A merge that could not be tried falls back to every shared path, as the wait was
// decided before.
async function conflicting_paths(
	lane: LaneInfo,
	shared: ReadonlyArray<string>,
): Promise<Array<string>> {
	const theirs = await lane_head(lane.directory)
	const conflicted =
		theirs === undefined
			? undefined
			: git_merge_conflicts.working_tree_conflicts(theirs, shared, process.cwd())

	return (conflicted ?? shared).filter((file_path) => !REGENERATED_PATHS.has(file_path))
}

async function shared_paths(
	lane: LaneInfo,
	launch: Launch,
	own: ReadonlySet<string>,
): Promise<Array<string>> {
	if (!(await is_open_ship(lane, launch))) return []

	const paths = await lane_paths(lane.directory)
	const shared = paths.filter((file_path) => own.has(file_path))

	if (shared.length === 0) return []

	return await conflicting_paths(lane, shared)
}

async function other_lanes(issue: string): Promise<ReadonlyArray<LaneInfo>> {
	const lanes = await lane_registry.list_lanes()

	return lanes.filter((lane) => lane.issue !== issue && !lane.is_stranded)
}

// Every other lane whose open pull request, shipped before this one, conflicts with this lane's change,
// with the conflicting paths.
async function find_overlap(issue: string): Promise<Overlap> {
	const own = new Set(await changed_paths.read_changed_paths(false))
	const launch = own_launch(issue)
	const others = await other_lanes(issue)
	const shared = await Promise.all(
		others.map(async (lane) => await shared_paths(lane, launch, own)),
	)

	return {
		lanes: others.filter((_lane, index) => (shared[index] ?? []).length > 0),
		paths: [...new Set(shared.flat())].toSorted((left, right) => left.localeCompare(right)),
	}
}

async function read_overlap(issue: string): Promise<Overlap> {
	try {
		return await find_overlap(issue)
	} catch {
		return { lanes: [], paths: [] }
	}
}

function is_settled(lanes: ReadonlyArray<LaneInfo>): boolean {
	return lanes.every((lane) => !lane_handoff.is_ship_running(lane.issue, lane.directory))
}

async function wait_for(lanes: ReadonlyArray<LaneInfo>, options: OverlapOptions): Promise<boolean> {
	return await poll.poll_until(async () => is_settled(lanes), {
		attempts: MAX_WAIT_ATTEMPTS,
		interval_ms: WAIT_INTERVAL_MS,
		sleeper: options.sleeper ?? poll.sleep,
	})
}

// Waits out every overlapping open ship and records the decision, returning what was recorded; a lane
// that overlaps nothing returns `undefined` at once and writes nothing. Best-effort: an overlap that
// could not be read is no overlap, so the sync is never blocked by the check that only exists to make
// it land cleaner.
async function await_overlap(
	issue: string,
	options: OverlapOptions = {},
): Promise<OverlapRecord | undefined> {
	const overlap = await read_overlap(issue)

	if (overlap.lanes.length === 0) return undefined

	const started = Date.now()
	const is_cleared = await wait_for(overlap.lanes, options)
	const lanes = overlap.lanes.map((lane) => Number(lane.issue))
	const waited_ms = Date.now() - started
	const record = { issue: Number(issue), lanes, paths: [...overlap.paths], waited_ms, is_cleared }

	await lane_ledger.record_overlap(record, options.ledger)

	return record
}

// The line the sync stage prints for a recorded wait, or `''` where nothing overlapped.
function note(record: OverlapRecord | undefined): string {
	if (record === undefined) return ''

	const lanes = record.lanes.map((lane) => session_cite.issue(lane)).join(', ')
	const outcome = record.is_cleared ? 'waited for' : 'gave up waiting for'

	return `${outcome} ${lanes}, whose open pull requests conflict on: ${record.paths.join(', ')}`
}

const run_ship_overlap = { MAX_WAIT_ATTEMPTS, await_overlap, note }

export type { OverlapOptions }
export { run_ship_overlap }

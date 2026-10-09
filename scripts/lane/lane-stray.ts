import { existsSync, lstatSync, readdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { error_text } from '#scripts/lib/error-message'
import { lane_leftover } from './lane-leftover'
import { lane_open } from './lane-open'
import { lane_paths } from './lane-paths'
import { lane_registry } from './lane-registry'

// What the lanes root holds that no registered work tree accounts for.
//
// **Every other sweep starts from `git worktree list`**, so a directory whose registration is gone —
// a lane whose `rmSync` stopped half-way, one whose `.git` points at a registration git pruned, an
// empty lanes root a lane once nested inside itself — is invisible to all of them, and stays on disk
// for good. This reads the root itself.
//
// **A stray is removed only when removing it loses nothing** — `lane_leftover.foreign_paths`, the one
// test `lane:open`'s reclaim also applies. One that holds anything else is kept and reported with what
// it holds; so is every entry whose name the lane machinery never writes, because nothing here knows
// who put it there. The root's own `.seat-locks` and every registered work tree are not strays.

type StrayVerdict = 'foreign' | 'not-a-lane' | 'opening' | 'removed' | 'stuck' | 'unreadable'

interface Stray {
	path: string
	verdict: StrayVerdict
	// The paths inside it whose removal would lose something — only on `foreign`.
	foreign: Array<string>
}

function stray_names(root: string, registered: ReadonlySet<string>): Array<string> {
	if (!existsSync(root)) return []

	return readdirSync(root).filter(
		(name) => name !== lane_paths.SEAT_LOCK_DIR && !registered.has(path.join(root, name)),
	)
}

function is_lane_directory(directory: string): boolean {
	return lane_paths.is_lane_entry(path.basename(directory)) && lstatSync(directory).isDirectory()
}

// A removal that stops part-way is judged by what is left, exactly as `lane:close` judges its own —
// and what is left is a stray the next sweep reads again.
function remove(directory: string): StrayVerdict {
	try {
		rmSync(directory, { force: true, recursive: true })
	} catch (error) {
		error_text.trace_swallowed('lane_stray.remove', error)
	}

	return existsSync(directory) ? 'stuck' : 'removed'
}

// **A `lane:open` in flight holds a seat lock from before its `worktree add` until after the
// registration**, so while any lock is held a numbered directory may be a lane being created, not a
// leftover — it is kept, and the next sweep reads it again.
interface SweepContext {
	recoverable: ReadonlySet<string>
	is_opening: boolean
}

function judge(directory: string, context: SweepContext): Stray {
	if (!is_lane_directory(directory)) return { path: directory, verdict: 'not-a-lane', foreign: [] }
	if (context.is_opening) return { path: directory, verdict: 'opening', foreign: [] }

	const foreign = lane_leftover.foreign_paths(directory, context.recoverable)

	if (foreign.length > 0) return { path: directory, verdict: 'foreign', foreign }

	return { path: directory, verdict: remove(directory), foreign: [] }
}

// One stray that cannot be read — a permission, a file vanishing mid-walk — is kept and reported
// rather than thrown, so it never stops the sweep of the rest.
function judge_safely(directory: string, context: SweepContext): Stray {
	try {
		return judge(directory, context)
	} catch (error) {
		error_text.trace_swallowed('lane_stray.judge', error)

		return { path: directory, verdict: 'unreadable', foreign: [] }
	}
}

/** Remove the lanes root's unregistered leftovers that hold nothing worth keeping; report the rest. */
async function sweep_strays(): Promise<Array<Stray>> {
	const root = lane_paths.lane_root(await lane_registry.main_repository_root())
	const registered = new Set(await lane_registry.registered_directories())
	const names = stray_names(root, registered)

	if (names.length === 0) return []

	const context: SweepContext = {
		recoverable: await lane_leftover.recoverable_objects(),
		is_opening: lane_open.open_in_flight_count(root) > 0,
	}

	return names.map((name) => judge_safely(path.join(root, name), context))
}

// The foreign paths a report names before it summarizes the rest as a count.
const NAMED_PATH_LIMIT = 5

function named_paths(foreign: ReadonlyArray<string>): string {
	const rest = foreign.length - NAMED_PATH_LIMIT
	const more = rest > 0 ? ` and ${String(rest)} more` : ''

	return `${foreign.slice(0, NAMED_PATH_LIMIT).join(', ')}${more}`
}

const KEPT_REASONS: Record<Exclude<StrayVerdict, 'foreign' | 'removed'>, string> = {
	'not-a-lane': 'not a name the lane machinery writes, so it was left alone',
	opening:
		'a `lane:open` holds a seat lock and this may be its lane; the next sweep reads it again — if no `lane:open` is running, the lock outlived a crash: remove the lanes root `.seat-locks` directory',
	stuck: 'the removal did not finish; the next `pnpm josh lane:prune` tries again',
	unreadable: 'it could not be read, so it was left in place',
}

/** One line per stray, for standard error. */
function describe(stray: Stray): string {
	if (stray.verdict === 'removed') return `Removed unregistered lane leftover ${stray.path}.`

	if (stray.verdict === 'foreign') {
		return `Kept ${stray.path}: it holds files git cannot restore (${named_paths(stray.foreign)}). Move them out and delete the directory.`
	}

	return `Kept ${stray.path}: ${KEPT_REASONS[stray.verdict]}.`
}

/** Sweep, and say on standard error what was removed and what was kept. */
async function sweep_and_report(): Promise<void> {
	const strays = await sweep_strays()

	for (const stray of strays) console.error(describe(stray))
}

const lane_stray = { describe, sweep_and_report, sweep_strays }

export type { Stray, StrayVerdict }
export { lane_stray }

import { spawnSync } from 'node:child_process'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { lane_reap } from './lane-reap'
import { process_directories } from './process-directories'

// Ending what still runs from a lane's checkout when the lane closes (joshuafolkken/kit#4304).
//
// **The lane child's tree and its `eslint_d` are not everything a lane starts.** A diagnostic the
// child launched under `script`, or a `node` it detached, is re-parented to pid 1 and outlives the
// merge: no tree reaches it and no title names it, and `run:board` drew such processes as a leftover
// holding gigabytes while nothing ended them. Its working directory still sits under the lane, which
// is what finds it — the same reading the board's leftover is drawn from (`process-directories.ts`).
//
// **Only that lane's directory, and never the caller.** Another lane's and the main checkout's
// processes are not under it. A `lane:close` run from inside the lane would match itself, so its
// ancestry is spared, as `lane-reap.ts` spares it — and so is its process group: its own helpers
// (`tsx`'s `esbuild`) and the commands piped beside it share the group, while a detached process
// (`script`, a new session) has left it.

const GROUP_ARGUMENTS = ['-o', 'pid=,pgid=', '-p']
const PID_SEPARATOR = ','
// `ps`'s line: the process and its group.
const PAIR_LENGTH = 2

interface ResidentProbes {
	// `undefined` where the working directories could not be read.
	directories: () => ReadonlyMap<number, string> | undefined
	own: () => ReadonlySet<number>
	// Each listed process's group; a process gone by then is missing.
	groups_of: (pids: ReadonlyArray<number>) => ReadonlyMap<number, number>
	terminate: (pid: number) => boolean
}

function parse_groups(printed: string): Map<number, number> {
	const pairs = printed
		.split('\n')
		.map((line) => line.trim().split(/\s+/u).map(Number))
		.filter((pair) => pair.length === PAIR_LENGTH && pair.every((id) => Number.isSafeInteger(id)))

	return new Map(pairs.map(([pid = 0, group = 0]) => [pid, group] as const))
}

// `ps` exits non-zero when a listed process is gone and still prints the rest, so its output is read
// whatever the exit status.
function groups_of(pids: ReadonlyArray<number>): Map<number, number> {
	const result = spawnSync(lane_reap.PS_COMMAND, [...GROUP_ARGUMENTS, pids.join(PID_SEPARATOR)], {
		encoding: 'utf8',
		timeout: PROBE_TIMEOUT_MS,
		stdio: ['ignore', 'pipe', 'ignore'],
	})

	return parse_groups(result.stdout)
}

const SYSTEM_PROBES: ResidentProbes = {
	directories: () => process_directories.list_all(),
	own: () => lane_reap.own_ancestry(),
	groups_of,
	terminate: (pid) => lane_reap.SYSTEM_PROBES.terminate(pid),
}

// The candidates outside the caller's process group. The caller's own group unread spares nothing
// more: its ancestry is spared regardless.
function outside_own_group(candidates: Array<number>, probes: ResidentProbes): Array<number> {
	if (candidates.length === 0) return candidates
	const groups = probes.groups_of([process.pid, ...candidates])
	const own_group = groups.get(process.pid)

	return candidates.filter((pid) => own_group === undefined || groups.get(pid) !== own_group)
}

/**
 * The processes whose working directory sits under the lane `directory`, the caller's ancestry and
 * process group left out; `undefined` where the working directories could not be read.
 */
function residents(
	directory: string,
	probes: ResidentProbes = SYSTEM_PROBES,
): Array<number> | undefined {
	const directories = probes.directories()

	if (directories === undefined) return undefined
	const own = probes.own()
	const candidates = [...directories]
		.filter(([pid, cwd]) => !own.has(pid) && process_directories.is_within(cwd, directory))
		.map(([pid]) => pid)

	return outside_own_group(candidates, probes)
}

/**
 * Terminate the processes still running from the lane `directory`, except `spared` — what the close
 * already ended. Returns the pids the signal reached, `undefined` where they could not be read.
 */
function end_residents(
	directory: string,
	spared: ReadonlyArray<number>,
	probes: ResidentProbes = SYSTEM_PROBES,
): Array<number> | undefined {
	return residents(directory, probes)
		?.filter((pid) => !spared.includes(pid))
		.filter((pid) => probes.terminate(pid))
}

/**
 * What `end_residents` did, said for the issue `cited`; `undefined` when nothing ran from the checkout.
 * A reading that failed is said, never read as none.
 */
function residents_sentence(
	ended: ReadonlyArray<number> | undefined,
	cited: string,
): string | undefined {
	if (ended === undefined) {
		return `Could not read which processes still run from the lane checkout for ${cited} (lsof failed); none of them was ended.`
	}

	if (ended.length === 0) return undefined

	return `Terminated ${String(ended.length)} process(es) still running from the lane checkout for ${cited}: ${ended.join(', ')}.`
}

/** Print `residents_sentence` to stderr, where a close reports what it ended. */
function report(ended: ReadonlyArray<number> | undefined, cited: string): void {
	const sentence = residents_sentence(ended, cited)

	if (sentence !== undefined) console.error(sentence)
}

const lane_residents = { end_residents, parse_groups, report, residents_sentence }

export type { ResidentProbes }
export { lane_residents }

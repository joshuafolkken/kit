import { execFileSync } from 'node:child_process'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { lane_child_invocation } from './lane-child-invocation'
import { process_tools } from './process-tools'

// Ending a lane child that did not end itself.
//
// **A detached child is kept alive on purpose and was never ended by anything.** `detached_launch`
// lets a child outlive its parent's session, and every reader of it — `run:liveness`, the 30-minute
// silence window — only *reads* whether it stopped. So a child that merged and then hung on a wait
// loop of its own lived on for a day, and the documented `pgrep -laf "fullrun #<N>$"` answered
// `alive` for that issue number forever, which is a verification answering wrongly. The close and the
// park are where the run has already decided the child is finished, so the reaping lives with them.
//
// **The whole process tree goes, collected before anything is signalled.** The hang is usually in a
// shell the child spawned, not in the child itself, and a descendant signalled after its parent died
// has already been re-parented out of reach — so the tree is read first, then terminated.
//
// **The caller's own ancestry is never touched.** A `lane:close` issued from inside the lane it
// closes would otherwise end the very session running it, before it could report.

const PGREP_COMMAND = 'pgrep'
const MATCH_FULL_COMMAND_LINE = '-f'
const CHILDREN_OF_FLAG = '-P'
// The same absolute `ps` `process-identity.ts` probes with, so the lookup does not depend on `PATH`.
const PS_COMMAND = '/bin/ps'
const PARENT_FORMAT = ['-o', 'ppid=', '-p']
const TERMINATE_SIGNAL = 'SIGTERM'
const CONTINUE_SIGNAL = 'SIGCONT'
// `0` addresses the caller's own process group and `1` is init — neither is ever a lane child.
const LOWEST_CHILD_PID = 2

// What collecting a lane's process tree reads — shared with `lane:pause` (`lane-pause.ts`).
interface TreeProbes {
	matching: (pattern: string) => Array<number>
	children_of: (pid: number) => Array<number>
	parent_of: (pid: number) => number | undefined
}

interface ReapProbes extends TreeProbes {
	terminate: (pid: number) => boolean
}

function parse_pids(printed: string): Array<number> {
	return printed
		.split('\n')
		.map((line) => Number(line.trim()))
		.filter((pid) => Number.isSafeInteger(pid) && pid >= LOWEST_CHILD_PID)
}

// `pgrep` exits 1 when nothing matches, which `execFileSync` throws — the empty list either way. A
// probe that is not installed is refused by name: reading it as "nothing there" is how a missing `ps`
// left the owner check answering `unknown`.
function run_probe(command: string, args: ReadonlyArray<string>): string {
	try {
		return execFileSync(command, [...args], {
			encoding: 'utf8',
			timeout: PROBE_TIMEOUT_MS,
			stdio: ['ignore', 'pipe', 'ignore'],
		})
	} catch (error) {
		process_tools.throw_if_missing(command, error)

		return ''
	}
}

function parent_of(pid: number): number | undefined {
	return parse_pids(run_probe(PS_COMMAND, [...PARENT_FORMAT, String(pid)]))[0]
}

function send(pid: number, name: NodeJS.Signals): boolean {
	try {
		process.kill(pid, name)

		return true
	} catch {
		return false
	}
}

// A stopped process (`lane:pause`) holds a SIGTERM it handles pending until it is continued, so the
// terminate is followed by a SIGCONT; a running process ignores it.
function terminate(pid: number): boolean {
	if (!send(pid, TERMINATE_SIGNAL)) return false

	send(pid, CONTINUE_SIGNAL)

	return true
}

const SYSTEM_PROBES: ReapProbes = {
	matching: (pattern) => parse_pids(run_probe(PGREP_COMMAND, [MATCH_FULL_COMMAND_LINE, pattern])),
	children_of: (pid) => parse_pids(run_probe(PGREP_COMMAND, [CHILDREN_OF_FLAG, String(pid)])),
	parent_of,
	terminate,
}

function ancestry_of(pid: number, probes: TreeProbes): Set<number> {
	const ancestry = new Set<number>([pid])
	let current = probes.parent_of(pid)

	while (current !== undefined && !ancestry.has(current)) {
		ancestry.add(current)
		current = probes.parent_of(current)
	}

	return ancestry
}

// This process and every process above it. The Stop hook reads it to tell whether the session that
// declared a carry record's `--owner "$PPID"` is the one it runs under.
function own_ancestry(probes: TreeProbes = SYSTEM_PROBES): Set<number> {
	return ancestry_of(process.pid, probes)
}

function tree_of(roots: ReadonlyArray<number>, probes: TreeProbes): Array<number> {
	const tree: Array<number> = []
	const pending = [...roots]
	let next = pending.shift()

	while (next !== undefined) {
		if (!tree.includes(next)) {
			tree.push(next)
			pending.push(...probes.children_of(next))
		}

		next = pending.shift()
	}

	return tree
}

function roots_of(issue: string, own: Set<number>, probes: TreeProbes): Array<number> {
	const pattern = lane_child_invocation.process_pattern(issue)

	return probes.matching(pattern).filter((pid) => !own.has(pid))
}

/**
 * Every process of the lane child for `issue` and everything under it, collected before anything is
 * signalled, the caller's own ancestry left out.
 */
function lane_tree(issue: string, probes: TreeProbes = SYSTEM_PROBES): Array<number> {
	const own = own_ancestry(probes)

	return tree_of(roots_of(issue, own, probes), probes).filter((pid) => !own.has(pid))
}

/**
 * Terminate every process of the lane child for `issue` and everything under it, sparing the caller's
 * own ancestry. Returns the pids that were signalled — the empty list is the healthy case, a child
 * that had already ended by itself.
 */
function reap_child(issue: string, probes: ReapProbes = SYSTEM_PROBES): Array<number> {
	return lane_tree(issue, probes).filter((pid) => probes.terminate(pid))
}

/** Whether a lane child for `issue` is running, by the same match `reap_child` would end. */
function is_child_running(issue: string, probes: TreeProbes = SYSTEM_PROBES): boolean {
	return roots_of(issue, own_ancestry(probes), probes).length > 0
}

const lane_reap = {
	is_child_running,
	lane_tree,
	own_ancestry,
	parse_pids,
	PS_COMMAND,
	reap_child,
	run_probe,
	SYSTEM_PROBES,
}

export type { ReapProbes, TreeProbes }
export { lane_reap }

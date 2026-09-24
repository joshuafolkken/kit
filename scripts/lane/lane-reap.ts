import { execFileSync } from 'node:child_process'
import { lane_child_invocation } from './lane-child-invocation'

// Ending a lane child that did not end itself (joshuafolkken/kit#2421).
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
// A probe that hung would hang the close it runs inside; failing answers "no process", which leaves
// the lane exactly as it was before this module existed.
const PROBE_TIMEOUT_MS = 2000
// `0` addresses the caller's own process group and `1` is init — neither is ever a lane child.
const LOWEST_CHILD_PID = 2

interface ReapProbes {
	matching: (pattern: string) => Array<number>
	children_of: (pid: number) => Array<number>
	parent_of: (pid: number) => number | undefined
	terminate: (pid: number) => boolean
}

function parse_pids(printed: string): Array<number> {
	return printed
		.split('\n')
		.map((line) => Number(line.trim()))
		.filter((pid) => Number.isSafeInteger(pid) && pid >= LOWEST_CHILD_PID)
}

// `pgrep` exits 1 when nothing matches, which `execFileSync` throws — the empty list either way.
function run_probe(command: string, args: ReadonlyArray<string>): string {
	try {
		return execFileSync(command, [...args], {
			encoding: 'utf8',
			timeout: PROBE_TIMEOUT_MS,
			stdio: ['ignore', 'pipe', 'ignore'],
		})
	} catch {
		return ''
	}
}

function parent_of(pid: number): number | undefined {
	return parse_pids(run_probe(PS_COMMAND, [...PARENT_FORMAT, String(pid)]))[0]
}

function terminate(pid: number): boolean {
	try {
		process.kill(pid, TERMINATE_SIGNAL)

		return true
	} catch {
		return false
	}
}

const SYSTEM_PROBES: ReapProbes = {
	matching: (pattern) => parse_pids(run_probe(PGREP_COMMAND, [MATCH_FULL_COMMAND_LINE, pattern])),
	children_of: (pid) => parse_pids(run_probe(PGREP_COMMAND, [CHILDREN_OF_FLAG, String(pid)])),
	parent_of,
	terminate,
}

function ancestry_of(pid: number, probes: ReapProbes): Set<number> {
	const ancestry = new Set<number>([pid])
	let current = probes.parent_of(pid)

	while (current !== undefined && !ancestry.has(current)) {
		ancestry.add(current)
		current = probes.parent_of(current)
	}

	return ancestry
}

// This process and every process above it. The Stop hook reads it to tell whether the session that
// declared a carry record's `--owner "$PPID"` is the one it runs under (joshuafolkken/kit#2472).
function own_ancestry(probes: ReapProbes = SYSTEM_PROBES): Set<number> {
	return ancestry_of(process.pid, probes)
}

function tree_of(roots: ReadonlyArray<number>, probes: ReapProbes): Array<number> {
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

/**
 * Terminate every process of the lane child for `issue` and everything under it, sparing the caller's
 * own ancestry. Returns the pids that were signalled — the empty list is the healthy case, a child
 * that had already ended by itself.
 */
function reap_child(issue: string, probes: ReapProbes = SYSTEM_PROBES): Array<number> {
	const own = own_ancestry(probes)
	const pattern = lane_child_invocation.process_pattern(issue)
	const roots = probes.matching(pattern).filter((pid) => !own.has(pid))
	const doomed = tree_of(roots, probes).filter((pid) => !own.has(pid))

	return doomed.filter((pid) => probes.terminate(pid))
}

const lane_reap = {
	own_ancestry,
	parse_pids,
	reap_child,
}

export type { ReapProbes }
export { lane_reap }

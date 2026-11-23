import { spawnSync } from 'node:child_process'
import { PROBE_TIMEOUT_MS } from '#scripts/lib/timeouts'
import { process_identity } from './process-identity'

// Which processes are stopped — sent SIGSTOP, as `lane:pause` does (joshuafolkken/kit#8869).
//
// **`ps`'s state is the one reading both platforms share**: BSD `ps` on macOS and procps-ng on Linux
// print a stopped process's state starting with `T`, followed by flags such as `N`. The probe runs
// with the same absolute path and empty environment `process_identity` reads start times with.
//
// **One `ps` per reading, not one per pid**: a listed pid that is gone may make `ps` exit non-zero,
// so its output is read whatever the exit status.
//
// **"Cannot tell" answers running**: a stopped process taken for a running one keeps a place it does
// not use, while the other way would give its place away under a process that still runs.

type StateReader = (pids: ReadonlyArray<number>) => Map<number, string>

const PS_COMMAND = '/bin/ps'
const STATE_FORMAT = 'pid=,stat='
const STOPPED_STATE = 'T'
const FIELD_SEPARATOR = /\s+/u

function parse_states(printed: string): Map<number, string> {
	const states = new Map<number, string>()

	for (const line of printed.split('\n')) {
		const [pid = '', state = ''] = line.trim().split(FIELD_SEPARATOR)

		if (state.length > 0) states.set(Number(pid), state)
	}

	return states
}

function read_states(pids: ReadonlyArray<number>): Map<number, string> {
	if (pids.length === 0) return new Map()

	const result = spawnSync(PS_COMMAND, ['-o', STATE_FORMAT, '-p', pids.join(',')], {
		encoding: 'utf8',
		timeout: PROBE_TIMEOUT_MS,
		stdio: ['ignore', 'pipe', 'ignore'],
		env: process_identity.PROBE_ENVIRONMENT,
	})

	return parse_states(result.stdout)
}

function stopped_pids(pids: ReadonlyArray<number>, read: StateReader = read_states): Set<number> {
	const states = read(pids)

	return new Set(pids.filter((pid) => states.get(pid)?.startsWith(STOPPED_STATE) === true))
}

const process_state = {
	read_states,
	stopped_pids,
}

export { process_state }
export type { StateReader }

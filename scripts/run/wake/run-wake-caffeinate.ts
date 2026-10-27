import { spawn, type SpawnOptions } from 'node:child_process'
import { existsSync } from 'node:fs'

// **The host stays awake while a supervisor runs** (#5173). `lane-sleep.ts` takes host sleep out of a
// lane's net time but cannot prevent it, and an idle sleep stops every lane, CI wait and relaunch at
// once. `caffeinate -w <pid>` holds the assertion for exactly the supervisor's lifetime: a `--stop`, a
// crash or a reload's exit ends it with no bookkeeping, and the successor of a reload starts its own
// from this same call, so the hand-off needs no re-attach. `-i` blocks idle sleep, `-s` system sleep —
// lid-close sleep included, but only on AC power (`docs/how-to/run-backlog.md`).
const CAFFEINATE_PATH = '/usr/bin/caffeinate'
const CAFFEINATE_FLAGS = ['-i', '-s', '-w']

interface Started {
	on: (event: 'error', listener: () => void) => unknown
	unref: () => unknown
}

type Spawner = (command: string, args: Array<string>, options: SpawnOptions) => Started

function argv(pid: number): Array<string> {
	return [...CAFFEINATE_FLAGS, String(pid)]
}

// **A host without `caffeinate` (Linux, CI) runs the supervisor as before** — nothing is started and
// nothing is printed; a spawn that fails late is swallowed for the same reason.
function keep_awake(
	pid: number,
	is_present: (path: string) => boolean = existsSync,
	spawner: Spawner = spawn,
): void {
	if (!is_present(CAFFEINATE_PATH)) return

	const child = spawner(CAFFEINATE_PATH, argv(pid), { detached: true, stdio: 'ignore' })

	child.on('error', () => {
		// the supervisor runs without the assertion, as on a host without caffeinate
	})
	child.unref()
}

const run_wake_caffeinate = {
	CAFFEINATE_PATH,
	argv,
	keep_awake,
}

export type { Spawner, Started }
export { run_wake_caffeinate }

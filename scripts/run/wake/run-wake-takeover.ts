import { process_identity } from '#scripts/josh/process-identity'
import { poll } from '#scripts/lib/poll'
import { MS_PER_SECOND } from '#scripts/lib/timeouts'
import { run_wake } from './run-wake'
import { run_wake_stop } from './run-wake-stop'

// Whether the successor a reload launched took the run over (joshuafolkken/kit#4509).
//
// **A spawn is not a take-over.** A successor that dies at load — a `main:sync` that pulled main but
// whose reinstall failed — was still `launched`, and reading that as the hand-over would leave the run
// with nobody watching it and nothing saying so. The successor claims the wake record before anything
// else (`run-wake-await.ts`), so its pid on that record is the proof; its death, or no claim within the
// bound, is a reload that failed.

const TAKEOVER_INTERVAL_MS = MS_PER_SECOND
// A cold `tsx` start claims within seconds; the bound is generous so a loaded machine is not a failure.
const TAKEOVER_ATTEMPTS = 120

type TakeoverResult = 'taken' | 'died' | 'unclaimed'

interface TakeoverPorts {
	holder_pid: () => number | undefined
	is_alive: (pid: number) => boolean
	stop: (pid: number) => void
	sleeper?: (duration_ms: number) => Promise<void>
}

function ports_of(wake_target: string): TakeoverPorts {
	return {
		holder_pid: () => run_wake.read_wake(wake_target)?.pid,
		is_alive: process_identity.is_live_pid,
		stop: run_wake_stop.signal,
	}
}

function result_of(pid: number, ports: TakeoverPorts): TakeoverResult {
	if (ports.holder_pid() === pid) return 'taken'

	return ports.is_alive(pid) ? 'unclaimed' : 'died'
}

// **A successor still unclaimed at the bound is stopped**, so the failed reload's warning says what is
// true: left running, it would claim the run later and supervise one the warning and the board call
// stranded.
async function await_takeover(
	pid: number,
	ports: TakeoverPorts,
	attempts: number = TAKEOVER_ATTEMPTS,
): Promise<TakeoverResult> {
	await poll.poll_until(async () => result_of(pid, ports) !== 'unclaimed', {
		attempts,
		interval_ms: TAKEOVER_INTERVAL_MS,
		...(ports.sleeper && { sleeper: ports.sleeper }),
	})

	const result = result_of(pid, ports)

	if (result === 'unclaimed') ports.stop(pid)

	return result
}

const run_wake_takeover = { await_takeover, ports_of }

export type { TakeoverPorts, TakeoverResult }
export { run_wake_takeover }

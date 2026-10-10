import { run_wake_loop, type LoopStop } from './run-wake-loop'

// **A supervisor that fails while the run is still resumable restarts itself.** Otherwise a
// `backlog:drive` that exited on a transient failure would leave a valid carry record waiting for a
// `run:wake --start` that only a person is left to type — once the supervisor is gone, no AI session
// remains to resume it.
//
// **Bounded, and only the bound reaches a person.** A failure that is not transient fails again on
// every pass, so the restarts stop at `RESTART_LIMIT` and the last failure is handed back for the
// ordinary warning, its note saying how many restarts went before it.

const RESTART_LIMIT = 3

interface RestartPorts {
	// One run of the loop over the record the caller claimed once and holds across every restart, so a
	// `--stop` landing in the pause is read by the next pass as the person's stop.
	pass: () => Promise<LoopStop>
	// Whether the carry record can still be continued — `carried`, neither `expired` nor gone.
	is_resumable: () => boolean
	pause: () => Promise<void>
	note: (text: string) => void
}

function is_restartable(stop: LoopStop, restarts: number, ports: RestartPorts): boolean {
	return (
		stop.reason === run_wake_loop.FAILED_REASON && restarts < RESTART_LIMIT && ports.is_resumable()
	)
}

function restart_note(stop: LoopStop, restarts: number): string {
	return `the supervisor failed (${stop.note ?? 'no note'}); restarting it, ${String(restarts + 1)} of ${String(RESTART_LIMIT)}`
}

function with_restart_count(stop: LoopStop, restarts: number): LoopStop {
	if (restarts === 0 || stop.reason !== run_wake_loop.FAILED_REASON) return stop

	return {
		...stop,
		note: [stop.note, `after ${String(restarts)} automatic restarts`].filter(Boolean).join('\n'),
	}
}

async function supervise(ports: RestartPorts, restarts = 0): Promise<LoopStop> {
	const stop = await ports.pass()

	if (!is_restartable(stop, restarts, ports)) return with_restart_count(stop, restarts)

	ports.note(restart_note(stop, restarts))
	await ports.pause()

	return await supervise(ports, restarts + 1)
}

const run_wake_restart = { RESTART_LIMIT, supervise }

export { run_wake_restart }
export type { RestartPorts }

import { run_wake, type RunWake } from './run-wake'

// Stopping the supervisor, apart from the command that prints the verdict: `run:wake --stop` and
// `josh backlogrun --stop` both stop it here, so the one stop is never written twice.

// **Removing the record is the stop; the signal only shortens the wait.** A pid already gone, or one
// this process may not signal, is not an error — the loop ends at its next pass either way, because it
// re-reads the record it no longer finds and `run_wake.update_wake` refuses to write one back.
function signal(pid: number): void {
	try {
		process.kill(pid, 'SIGTERM')
	} catch {
		console.error(
			`Process ${String(pid)} could not be signalled; the record is removed regardless.`,
		)
	}
}

function signal_supervisor(wake: RunWake): void {
	if (run_wake.is_supervisor_live(wake)) signal(wake.pid)
}

// The record that was stopped, `undefined` where there was none to stop.
function stop(wake_target: string): RunWake | undefined {
	const wake = run_wake.read_wake(wake_target)

	if (wake === undefined) return undefined

	run_wake.remove_wake(wake_target)
	signal_supervisor(wake)

	return wake
}

const run_wake_stop = { signal, stop }

export { run_wake_stop }

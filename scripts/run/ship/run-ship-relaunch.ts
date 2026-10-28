import { detached_launch, type LaunchArgv } from '#scripts/run/detached-launch'
import { run_ship_detach } from './run-ship-detach'

// A supervisor's successor on new code (`run-ship-handover.ts`) is the same launch: it keeps the launch
// id, so every reader of the record — `ship:wait`, a lane's liveness, the overlap order by launch time —
// sees one ship throughout, and the successor's claim and result land on that record.
//
// **The record keeps naming this supervisor until the successor claims it**
// (`run_ship_detach.claim_identity`), so it is believed live throughout, and the successor's pid on it
// is the take-over's proof.
//
// **The successor is this very process's command line, re-invoked under the same runner**, as the wake
// supervisor re-invokes itself (`run-wake-session.ts`). Launched through `pnpm josh ship`, the spawned
// pid would be pnpm's while the claim names the node process under it, so no claim would ever match.

interface RelaunchRequest {
	repository: string
	number: string
	cwd: string
}

// The pid the ship record names.
function holder_pid(repository: string, number: string): number | undefined {
	return run_ship_detach.read_record(repository, number)?.pid
}

// The supervisor's own argv ends with its `"<title> #<N>"` title, which a lane's liveness pattern needs.
function successor_argv(): LaunchArgv {
	return { command: process.execPath, args: [...process.execArgv, ...process.argv.slice(1)] }
}

// The successor's pid, `undefined` where this process is no supervisor or none started.
function relaunch(request: RelaunchRequest): number | undefined {
	const launch_id = process.env[run_ship_detach.LAUNCH_ID_KEY]
	if (launch_id === undefined) return undefined
	const result = detached_launch.launch(
		{
			argv: successor_argv(),
			cwd: request.cwd,
			log_path: run_ship_detach.log_path(request.repository, request.number),
			env: run_ship_detach.supervisor_environment(launch_id),
		},
		console.error,
	)

	return result.kind === 'launched' ? result.pid : undefined
}

const run_ship_relaunch = { holder_pid, relaunch }

export { run_ship_relaunch }

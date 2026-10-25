import { fileURLToPath } from 'node:url'
import { issue_cite } from '#scripts/issue/issue-cite'
import { process_identity } from '#scripts/josh/process-identity'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_wake_code } from '#scripts/run/wake/run-wake-code'
import { run_wake_stop } from '#scripts/run/wake/run-wake-stop'
import { run_wake_takeover, type TakeoverPorts } from '#scripts/run/wake/run-wake-takeover'
import type { ShipSection } from './run-ship'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_relaunch } from './run-ship-relaunch'
import type { ShipArguments } from './run-ship-steps'

// A supervisor whose sync merged a change to its own code hands the ship to a successor on that code
// (joshuafolkken/kit#4849). The stages run in one process, so a review stage after a sync that pulled
// a fix to `scripts/review/` still judged on the code the supervisor started with.
//
// **The wake supervisor's mechanism, shared**: the loaded code is the import closure of the ship entry
// (`run-wake-code.ts`), and the successor's own claim on the ship record is the take-over's proof
// (`run-wake-takeover.ts`). A successor that dies or never claims leaves the record naming this
// supervisor, which runs the rest on the code it started with.

const ENTRY = fileURLToPath(new URL('run-ship-cli.ts', import.meta.url))
const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const HANDOVER_HEADER = '=== handover ==='
const SUCCESS_EXIT_CODE = 0

type CodeCheck = () => Promise<boolean>

async function never_stale(): Promise<boolean> {
	return false
}

// Only a supervisor hands over: a ship in an agent's own turn ends with that turn, which reads the
// next command on the merged code anyway.
async function watch(): Promise<CodeCheck> {
	if (!run_ship_detach.is_supervised()) return never_stale

	return await run_wake_code.watch(run_wake_code.source_of(ROOT, ENTRY))
}

function ports_of(repository: string, number: string): TakeoverPorts {
	return {
		holder_pid: () => run_ship_relaunch.holder_pid(repository, number),
		is_alive: process_identity.is_live_pid,
		stop: run_wake_stop.signal,
	}
}

// Several lanes' supervisors hand over at once, so each note leads with its issue for `run:board`.
async function note(number: string, text: string): Promise<void> {
	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.NOTE,
		`${issue_cite.plain(number)} ${text}`,
	)
}

async function take_over(args: ShipArguments, repository: string): Promise<number | undefined> {
	const pid = run_ship_relaunch.relaunch({ repository, number: args.number, cwd: process.cwd() })
	if (pid === undefined) return undefined
	const result = await run_wake_takeover.await_takeover(pid, ports_of(repository, args.number))

	return result === 'taken' ? pid : undefined
}

function handed_over(pid: number): ShipSection {
	return {
		header: HANDOVER_HEADER,
		body: `code changed on main — process ${String(pid)} ships the rest on the new code`,
		code: SUCCESS_EXIT_CODE,
	}
}

// The handover section where a successor took the ship over; `undefined` where the code is unchanged
// or no successor took it, and this supervisor runs the rest of the stages itself.
async function hand_over(
	args: ShipArguments,
	is_stale: CodeCheck,
): Promise<ShipSection | undefined> {
	if (!(await is_stale())) return undefined
	const repository = await run_ship_probe.repository_directory()
	if (repository === undefined) return undefined
	const pid = await take_over(args, repository)

	if (pid === undefined) {
		await note(
			args.number,
			`The ship supervisor's code changed on main, but no successor took the ship over, so process ${String(process.pid)} runs the rest on the code it started with.`,
		)

		return undefined
	}

	await note(
		args.number,
		`The ship supervisor's code changed on main, so process ${String(process.pid)} handed the ship to process ${String(pid)} on the new code.`,
	)

	return handed_over(pid)
}

const run_ship_handover = { hand_over, watch }

export type { CodeCheck }
export { run_ship_handover }

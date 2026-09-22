import { telegram_notify } from '#scripts/git/telegram-notify'
import { run_carry, type CarryRead, type RunCarry } from './run-carry'
import { run_event_stream } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'
import {
	run_stranded,
	type StrandedInput,
	type StrandedVerdict,
	type SupervisorLiveness,
} from './run-stranded'
import { run_wake, type RunWake } from './run-wake'

// The I/O half of the strand detector (joshuafolkken/kit#2375): it gathers the three facts the pure
// judge in `run-stranded.ts` weighs, then — on a strand — leaves the marker and sends the one
// notification. `stop-guard.ts` wires it into the Stop hook, so it runs at each loop boundary beside the
// stall detector it mirrors (joshuafolkken/kit#2359); the CLI exposes the same call for a person to run
// by hand.
//
// **Cheap and local.** Every read is a file on disk — the carry record, the wake record — and a process
// liveness probe; there is no network call, so unlike the stall detector this makes every read every
// time. The gate is the carry record itself: nothing carried, or a record that is expired or unreadable,
// returns before the wake record is even read.

// The recovery line names the command that hands the run to a fresh supervisor — the same one the pure
// judge holds, so the notification and the recovery can never drift. It is deliberately not
// `run:carry --resume`: the cutting session is refused `busy` and must stay refused
// (joshuafolkken/kit#1935), so recovery is another actor's.
const STRAND_RECOVERY = `Restart supervision with \`${run_stranded.RECOVERY_COMMAND}\` — it wakes a fresh successor to claim the budget; the cutting session must not resume it itself.`

// The seams a test replaces: the two record targets, the two record reads, the owner and supervisor
// liveness probes, and the two side effects. The defaults are the real readers; a test hands fakes so
// the gather and report logic run without a git tree, a process table or a network.
interface DetectPorts {
	resolve_targets: () => Promise<RecordTargets | undefined>
	read_carry: (target: string) => CarryRead
	is_owner_live: (carry: RunCarry) => boolean
	read_wake: (target: string) => RunWake | undefined
	supervisor_liveness: (wake: RunWake | undefined) => SupervisorLiveness
	emit_stranded: (text: string) => Promise<boolean>
	notify_stranded: (body: string) => Promise<boolean>
}

interface RecordTargets {
	carry: string
	wake: string
}

// Both records key on the common git directory, the same one `run-carry.ts` and `run-wake.ts` resolve,
// so a strand read from any lane reads the one run's records. `undefined` outside a repository: no git
// directory to key on, so no run to be stranded.
async function real_resolve_targets(): Promise<RecordTargets | undefined> {
	const directory = await run_carry.repository_directory()

	if (directory === undefined) return undefined

	return { carry: run_carry.carry_path(directory), wake: run_wake.wake_path(directory) }
}

async function real_emit_stranded(text: string): Promise<boolean> {
	return await run_event_stream_emit.emit_once(run_event_stream.EVENT_KIND.STRANDED, text)
}

async function real_notify_stranded(body: string): Promise<boolean> {
	return await telegram_notify.stranded({ body, recovery: STRAND_RECOVERY })
}

const DEFAULT_PORTS: DetectPorts = {
	resolve_targets: real_resolve_targets,
	read_carry: (target) => run_carry.read_carry(target),
	is_owner_live: run_carry.is_owner_live,
	read_wake: (target) => run_wake.read_wake(target),
	supervisor_liveness: (wake) => run_stranded.supervisor_liveness(wake),
	emit_stranded: real_emit_stranded,
	notify_stranded: real_notify_stranded,
}

// The three facts, assembled behind the carry-record gate. A non-`carried` read — nothing carried, a
// spent bound, or an unreadable record — is `undefined`: there is no live budget to be stranded, so the
// wake record is never read and the judge is never asked.
async function gather(ports: DetectPorts): Promise<StrandedInput | undefined> {
	const targets = await ports.resolve_targets()

	if (targets === undefined) return undefined

	const read = ports.read_carry(targets.carry)

	if (read.kind !== 'carried') return undefined

	return {
		read,
		is_owner_live: ports.is_owner_live(read.carry),
		supervisor: ports.supervisor_liveness(ports.read_wake(targets.wake)),
	}
}

// The marker and the notification, both once per strand episode. `emit_stranded` refuses a second while
// the strand event is still the newest, and its `false` is what holds the notification back too — so a
// strand polled every stop reaches the person once, not once a turn.
async function report(ports: DetectPorts, input: StrandedInput): Promise<void> {
	if (input.read.kind !== 'carried') return

	const text = run_stranded.describe(input.read.carry)

	if (await ports.emit_stranded(text)) await ports.notify_stranded(text)
}

// Read the three facts, print nothing, and on a strand leave the marker and notify. The verdict is
// returned for the CLI to print; the side effects are the report's.
async function detect_and_report(ports: DetectPorts = DEFAULT_PORTS): Promise<StrandedVerdict> {
	const input = await gather(ports)

	if (input === undefined) return run_stranded.OK

	const is_run_stranded = run_stranded.is_stranded(input)

	if (is_run_stranded) await report(ports, input)

	return run_stranded.verdict_of(is_run_stranded)
}

// Best-effort for the Stop hook: the detector is a report, so a failure to gather or notify is dropped
// rather than raised into the stop decision it rides alongside.
async function run_stranded_check(): Promise<void> {
	try {
		await detect_and_report()
	} catch {
		// Reporting is best-effort: a strand we could not read or send is dropped, never a blocked stop.
	}
}

const run_stranded_detect = { DEFAULT_PORTS, detect_and_report, gather, report, run_stranded_check }

export { run_stranded_detect }
export type { DetectPorts, RecordTargets }

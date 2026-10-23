import { telegram_notify } from '#scripts/notify/telegram-notify'
import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_carry_ended } from '#scripts/run/carry/run-carry-ended'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_wake, type RunWake } from '#scripts/run/wake/run-wake'
import {
	run_stranded,
	type StrandedInput,
	type StrandedVerdict,
	type SupervisorLiveness,
} from './run-stranded'

// The I/O half of the strand detector: it gathers the three facts the pure
// judge in `run-stranded.ts` weighs, then — on a strand — leaves the marker and sends the one
// notification. `stop-guard.ts` wires it into the Stop hook, so it runs at each loop boundary beside the
// stall detector it mirrors; the CLI exposes the same call for a person to run
// by hand.
//
// **Cheap and local.** Every read is a file on disk — the carry record, the wake record — and a process
// liveness probe; there is no network call, so unlike the stall detector this makes every read every
// time. The gate is the carry record itself: nothing carried, or a record that is unreadable,
// returns before the wake record is even read.

// The recovery line names the command that hands the run to a fresh supervisor — the same one the pure
// judge holds, so the notification and the recovery can never drift. It is deliberately not
// `run:carry --resume`: the cutting session is refused `busy` and must stay refused,
// so recovery is another actor's.
const STRAND_RECOVERY = `Restart supervision with \`${run_stranded.RECOVERY_COMMAND}\` — it wakes a fresh successor to claim the budget; the cutting session must not resume it itself.`

// The seams a test replaces: the two record targets, the two record reads, the ended-run read, the owner
// and supervisor liveness probes, and the two side effects. The defaults are the real readers; a test hands fakes so
// the gather and report logic run without a git tree, a process table or a network.
interface DetectPorts {
	resolve_targets: () => Promise<RecordTargets | undefined>
	read_carry: (target: string) => CarryRead
	is_owner_live: (carry: RunCarry) => boolean
	has_ended: (target: string, started_at: string) => boolean
	read_wake: (target: string) => RunWake | undefined
	supervisor_liveness: (wake: RunWake | undefined) => SupervisorLiveness
	emit_stranded: (text: string) => Promise<boolean>
	notify_stranded: (body: string) => Promise<boolean>
}

type SameProcess = NonNullable<Parameters<typeof run_stranded.supervisor_liveness>[1]>

interface RecordTargets {
	carry: string
	wake: string
}

// The run a supervisor was watching: its carry record, where `run:carry --end` records the run it
// removes, and the `started_at` the supervisor read when it took the run on.
interface WatchedRun {
	carry_target: string
	ended_target: string
	started_at: string
}

function targets_of(directory: string): RecordTargets {
	return { carry: run_carry.carry_path(directory), wake: run_wake.wake_path(directory) }
}

// Both records key on the common git directory, the same one `run-carry.ts` and `run-wake.ts` resolve,
// so a strand read from any lane reads the one run's records. `undefined` outside a repository: no git
// directory to key on, so no run to be stranded.
async function real_resolve_targets(): Promise<RecordTargets | undefined> {
	const directory = await run_carry.repository_directory()

	return directory === undefined ? undefined : targets_of(directory)
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
	has_ended: run_carry_ended.has_ended,
	read_wake: (target) => run_wake.read_wake(target),
	supervisor_liveness: (wake) => run_stranded.supervisor_liveness(wake),
	emit_stranded: real_emit_stranded,
	notify_stranded: real_notify_stranded,
}

// The three facts, assembled behind the carry-record gate. A non-`carried` read — nothing carried, or
// an unreadable record — is `undefined`: there is no live budget to be stranded, so the
// wake record is never read and the judge is never asked.
function input_at(ports: DetectPorts, targets: RecordTargets): StrandedInput | undefined {
	const read = ports.read_carry(targets.carry)

	if (read.kind !== 'carried') return undefined

	return {
		read,
		is_owner_live: ports.is_owner_live(read.carry),
		supervisor: ports.supervisor_liveness(ports.read_wake(targets.wake)),
	}
}

async function gather(ports: DetectPorts): Promise<StrandedInput | undefined> {
	const targets = await ports.resolve_targets()

	return targets === undefined ? undefined : input_at(ports, targets)
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

// The same judgement for a reader that draws the run rather than reports on it: `run:board` asks it
// every local read, so a run nobody is driving is not drawn as one still waiting for work.
function is_stranded_at(directory: string, ports: DetectPorts = DEFAULT_PORTS): boolean {
	const input = input_at(ports, targets_of(directory))

	return input !== undefined && run_stranded.is_stranded(input)
}

// The default ports with both liveness probes asked through `same_process` — `run:board` hands the one
// that reads its own `ps` snapshot (joshuafolkken/kit#4263).
function ports_with(same_process: SameProcess): DetectPorts {
	return {
		...DEFAULT_PORTS,
		is_owner_live: (carry) => run_carry.is_owner_live(carry, new Date(), same_process),
		supervisor_liveness: (wake) => run_stranded.supervisor_liveness(wake, same_process),
	}
}

// The judgement a supervisor asks of the run it is about to stop watching. The asker is that
// supervisor on its way out, so it is taken as gone, and so is an owner that is the asker itself
// (`run_carry.is_held_by_another`) — that owner is about to be gone. A
// record another session holds is not left stranded. **A record that does not read is left stranded
// unless `run:carry --end` ended this very run**: the read that failed the driver fails here too, and
// that run still has its budget and nobody watching it.
function is_left_stranded(run: WatchedRun, ports: DetectPorts = DEFAULT_PORTS): boolean {
	const read = ports.read_carry(run.carry_target)

	if (read.kind !== 'carried') return !ports.has_ended(run.ended_target, run.started_at)

	return run_stranded.is_stranded({
		read,
		is_owner_live: run_carry.is_held_by_another(read.carry, ports.is_owner_live),
		supervisor: run_stranded.GONE,
	})
}

const run_stranded_detect = {
	detect_and_report,
	is_left_stranded,
	is_stranded_at,
	ports_with,
	run_stranded_check,
}

export { run_stranded_detect }
export type { DetectPorts, RecordTargets, WatchedRun }

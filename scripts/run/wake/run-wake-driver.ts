import { epic_triage } from '#scripts/epic/epic-triage'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { run_carry, type CarryRead } from '#scripts/run/carry/run-carry'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_invocation } from '#scripts/run/run-invocation'
import type { DriveResult } from './run-wake-loop'

const SUCCESS = 0
const FIRST_LINE = 0
const RESUME_PREFIX = 'resume: '
const DETAILS_TAIL_LENGTH = 2048
const TRUNCATION_MARK = '... '
// The prefix `backlog-drive-cli.ts` gives the exception it catches.
const ERROR_PREFIX = 'error '
// **The driver is bounded so the supervisor reaches its pass boundary between dispatches**
// (joshuafolkken/kit#4509): unbounded, `backlog:drive` dispatches, collects and merges lanes in its own
// loop until a judgment hand-off, and the code check at the pass boundary would wait for that.
const WINDOW_MINUTES = 5
const WINDOW_MS = WINDOW_MINUTES * MS_PER_MINUTE
const WINDOW_VERDICT = 'window'
const { TRIAGE_VERDICT } = epic_triage

function driver_args(invocation: string): ReadonlyArray<string> | undefined {
	const rebuilt = run_invocation.rebuild(invocation)
	if (rebuilt !== invocation) return undefined
	const named_count = run_invocation.issue_numbers(rebuilt)?.length ?? 0

	return [
		'backlog:drive',
		'--owner',
		String(process.pid),
		'--window',
		String(WINDOW_MINUTES),
		...rebuilt.split(' ').slice(1 + named_count),
	]
}

function is_final_stop(verdict: string | undefined, read: CarryRead): boolean {
	return verdict?.startsWith('stop') === true && read.kind === 'none'
}

// **The details are the driver's whole stderr, so only their tail is handed on, and it goes last.**
// The stderr carries every command the driver ran since it started, which
// after a long run is tens of kilobytes — far past what `is_safe_value` lets into an argv element. Its
// tail is where the reason for stopping is; placing it last means the cap `wake_argv` applies to the
// whole prompt can only ever cut into the details, never the verdict, the resume line or the epic note.
function details_tail(details: string): string {
	return details.length > DETAILS_TAIL_LENGTH
		? `${TRUNCATION_MARK}${details.slice(-DETAILS_TAIL_LENGTH)}`
		: details
}

// **The hand-off names its next move, so the woken session never searches the procedure for it.**
// Whatever the branch, the session acts on it and ends its turn, whose stop hook writes the cut that
// hands the loop back to the supervisor (`run_headless.hand_back_at_turn_end`); only a person's stop
// ends the run instead.
//
// **The claim comes first.** The supervisor hands the record off before the
// wake, so until the session adopts it with `--resume` every count it writes — `--merged`, `--done`,
// the closing cut — is refused as advancing a handed-off budget, and the supervisor, seeing no claim,
// ends the run as a failed wake.
const HAND_BACK = 'then end the turn, which hands the loop back'
const NEXT_BY_VERDICT: ReadonlyArray<readonly [string, string]> = [
	[
		'retrospective',
		`run what pnpm josh run:step prints (retrospective.md), close it with pnpm josh run:carry --retrospective --summary "<result>", ${HAND_BACK}`,
	],
	[
		'merge human-review',
		'stop the run, because the child stopped before its commit for a person (needs-human-review.md)',
	],
	['epic #', `follow backlogrun-steps.md → "Named issues run first, in order", ${HAND_BACK}`],
]
const NEXT_DEFAULT = `act on the result by backlogrun-steps.md → "The loop", ${HAND_BACK}`

function next_move(verdict: string, invocation: string): string {
	const found = NEXT_BY_VERDICT.find(([prefix]) => verdict.startsWith(prefix))

	return `\nNext: first claim the carry record with ${run_carry.claim_command(invocation)}, then ${found?.[1] ?? NEXT_DEFAULT}`
}

function handoff_material(
	verdict: string,
	resume: string,
	invocation: string,
	details: string,
): string {
	const context = details === '' ? '' : `\nDetails: ${details_tail(details)}`
	const epic = verdict.startsWith('epic #')
		? '\nThe named item is an epic. Follow backlogrun-steps.md named epic procedure; do not launch the epic root as a fullrun child. After all children merge or park, record the root with pnpm josh run:carry --done <epic-number> before continuing to the next named item.'
		: ''

	return `Driver result: ${verdict}\n${resume}${epic}${next_move(verdict, invocation)}${context}`
}

function driver_result(
	out: string,
	read: CarryRead,
	invocation: string,
	details = '',
): DriveResult {
	const lines = out.split('\n')
	const verdict = lines[FIRST_LINE]

	if (is_final_stop(verdict, read)) return { kind: 'finished' }
	const resume = lines.find((line) => line.startsWith(RESUME_PREFIX))

	if (verdict === undefined || resume === undefined) {
		return { kind: 'failed', note: `backlog:drive returned an incomplete result: ${out}` }
	}

	return { kind: 'judgment', material: handoff_material(verdict, resume, invocation, details) }
}

// **The cause is the driver's stdout `error …` line, so it leads the note.** `backlog:drive` prints an
// exception only to stdout, and its stderr is never empty — every command it ran is there — so reading
// `err ?? out` would drop the one line that says why. The stderr follows as its
// tail, for the same reason `details_tail` cuts a judgment's details.
function cause_of(out: string): string {
	const errors = out.split('\n').filter((line) => line.startsWith(ERROR_PREFIX))

	return errors.length > 0 ? errors.join('\n') : details_tail(out)
}

function failure_note(result: JoshResult): string {
	return [cause_of(result.out), details_tail(result.err ?? '')].filter(Boolean).join('\n')
}

function read_result(
	result: JoshResult | undefined,
	target: string,
	invocation: string,
): DriveResult {
	if (result === undefined) return { kind: 'released' }
	if (result.code !== SUCCESS) return { kind: 'failed', note: failure_note(result) }

	return driver_result(result.out, run_carry.read_carry(target), invocation, result.err)
}

// **A record this process already owns is claimed again.** A driver that failed leaves the record
// adopted for the supervisor and not handed off, and the restarted pass re-drives it from here; only a
// record another live process holds is refused.
function claim_record(target: string, invocation: string): boolean {
	const current = run_carry.read_carry(target)
	if (current.kind !== 'carried' || current.carry.invocation !== invocation) return false

	if (current.carry.is_handed_off !== true && run_carry.is_held_by_another(current.carry)) {
		return false
	}

	const owner = {
		...run_carry.owner_of(process.pid),
		provider: current.carry.scheduler_provider,
	}

	return run_carry.adopt_carry(target, current.carry, owner) !== undefined
}

// **A verdict with nothing to judge is re-driven here, never handed to a session.** A woken session
// met with `merge busy` or `merge retry` could only cut and hand the loop back for the same driver to
// run again — a model round trip, at a cache write each, that decides nothing. The record is already
// this process's, so the rerun needs no fresh claim; the limit keeps a driver that never settles from
// holding the supervisor past its own checks.
const RERUN_VERDICTS: ReadonlyArray<string> = ['merge busy', 'merge retry']
const RERUN_LIMIT = 10
const RERUN_PAUSE_MS = 60_000

type Pause = (ms: number) => Promise<void>

async function pause(ms: number): Promise<void> {
	await new Promise((resolve) => {
		setTimeout(resolve, ms)
	})
}

function is_verdict(result: JoshResult, entries: ReadonlyArray<string>): boolean {
	const verdict = result.out.split('\n', 1)[FIRST_LINE] ?? ''

	return (
		result.code === SUCCESS &&
		entries.some((entry) => verdict === entry || verdict.startsWith(`${entry} `))
	)
}

// A record that was removed during the pause answers `undefined`: its stale verdict must not reach a
// session, so the supervisor's own next pass re-reads the record and ends the run as `ended` or
// `stopped`; a rerun would only fail on it and report the run as `failed`.
//
// **A spent window answers `undefined` too**, so the supervisor's next pass checks its code before it
// drives again; the restarted driver adopts the lanes still in flight.
async function run_driver(
	target: string,
	args: ReadonlyArray<string>,
	wait: Pause,
	remaining: number,
): Promise<JoshResult | undefined> {
	const result = await josh_command.josh_run(args, true)
	if (is_verdict(result, [WINDOW_VERDICT])) return undefined
	if (remaining === 0 || !is_verdict(result, RERUN_VERDICTS)) return result

	await wait(RERUN_PAUSE_MS)
	if (run_carry.read_carry(target).kind !== 'carried') return undefined

	return await run_driver(target, args, wait, remaining - 1)
}

// **Triage waits for the launched parent while it plans** (joshuafolkken/kit#5516): `josh backlogrun`
// hands this supervisor the record before its parent plans, and labelling the pool is that plan's
// work — a session woken for the same `triage` would label the same issues beside it. The pause keeps
// the re-drive from polling the tracker in a tight loop.
async function deferred_triage(
	result: JoshResult | undefined,
	wait: Pause,
	is_parent_planning: () => boolean,
): Promise<JoshResult | undefined> {
	if (result === undefined || !is_verdict(result, [TRIAGE_VERDICT]) || !is_parent_planning()) {
		return result
	}

	await wait(RERUN_PAUSE_MS)

	return undefined
}

// **A result handed to a session is said on the stream first.** The driver has stopped asking, so
// without it the board keeps the `handing off` this pass wrote and a run waiting on a session's
// judgment reads as one still getting ready.
async function announced(result: DriveResult): Promise<DriveResult> {
	if (result.kind === 'judgment') await run_event_setup.emit(run_event_setup.STAGE.JUDGING)

	return result
}

function never_planning(): boolean {
	return false
}

async function drive_with(
	target: string,
	wait: Pause,
	is_parent_planning: () => boolean,
): Promise<DriveResult> {
	const read = run_carry.read_carry(target)
	if (read.kind !== 'carried') return { kind: 'failed', note: 'The carry record changed.' }

	const args = driver_args(read.carry.invocation)
	if (args === undefined) return { kind: 'failed', note: 'The carried invocation is invalid.' }

	if (!claim_record(target, read.carry.invocation)) {
		return { kind: 'failed', note: 'The driver could not claim the carry record.' }
	}

	await run_event_setup.emit(run_event_setup.STAGE.HANDING_OFF)

	const result = await deferred_triage(
		await run_driver(target, args, wait, RERUN_LIMIT),
		wait,
		is_parent_planning,
	)

	return await announced(read_result(result, target, read.carry.invocation))
}

async function drive(
	target: string,
	wait: Pause = pause,
	is_parent_planning: () => boolean = never_planning,
): Promise<DriveResult> {
	return await drive_with(target, wait, is_parent_planning)
}

export const run_wake_driver = { RERUN_LIMIT, WINDOW_MS, drive, driver_args, driver_result }

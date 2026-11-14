import { backlog_drive_retrospective_unit } from '#scripts/backlog/backlog-drive-retrospective-unit'
import { epic_triage } from '#scripts/epic/epic-triage'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { run_carry, type CarryRead, type RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import { run_invocation } from '#scripts/run/run-invocation'
import { run_step_section_driver } from '#scripts/run/run-step-section-driver'
import type { DriveResult } from './run-wake-loop'
import { run_wake_resume } from './run-wake-resume'
import { run_wake_window } from './run-wake-window'

const SUCCESS = 0
const FIRST_LINE = 0
const DETAILS_TAIL_LENGTH = 2048
const TRUNCATION_MARK = '... '
// The prefix `backlog-drive-cli.ts` gives the exception it catches.
const ERROR_PREFIX = 'error '
const { WINDOW_MINUTES } = run_wake_window
const WINDOW_VERDICT = 'window'
// `backlog-drive.ts`'s drain owing the retrospective.
const WATCH_VERDICT = 'watch'
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
// after a long run is tens of kilobytes — far past what `is_safe_prompt` lets into the prompt. Its
// tail is where the reason for stopping is; placing it last means the cap `wake_argv` applies to the
// whole prompt can only ever cut into the details, never the verdict, the resume line, the epic note
// or the sections.
function details_tail(details: string): string {
	return details.length > DETAILS_TAIL_LENGTH
		? `${TRUNCATION_MARK}${details.slice(-DETAILS_TAIL_LENGTH)}`
		: details
}

// **The hand-off names its next move and carries the sections that govern it** (joshuafolkken/kit#5920),
// so the woken session neither searches the procedure nor spends a `doc:section` turn on it
// (`run_step_section_driver.driver_sections`). Whatever the branch, the session acts on it and ends its
// turn, whose stop hook writes the cut that hands the loop back to the supervisor
// (`run_headless.hand_back_at_turn_end`); only a person's stop ends the run instead.
//
// **The record is the session's before it wakes** (`run-wake-handoff.ts`), so the move names no claim.
// It does say not to `--begin`: over a record the session already owns, that answers `standing`.
const ALREADY_CLAIMED =
	"the carry record is already this session's, so run no pnpm josh run:carry --begin;"
const HAND_BACK = 'then end the turn, which hands the loop back'
const NEXT_BY_VERDICT: ReadonlyArray<readonly [string, string]> = [
	[
		'retrospective',
		`run what pnpm josh run:step prints (the retrospective below), close it with pnpm josh run:carry --retrospective --summary "<result>", ${HAND_BACK}`,
	],
	[
		'merge human-review',
		'stop the run, because the child stopped before its commit for a person (the section below)',
	],
	['epic #', `follow the named-issue sections below, ${HAND_BACK}`],
]
const NEXT_DEFAULT = `act on the result by the sections below, ${HAND_BACK}`
// **A triage session is woken beside the driver, never in its place** (joshuafolkken/kit#7120): the
// record stays the supervisor's, so the session counts nothing and its turn end hands nothing back.
const BESIDE =
	"\nNext: the carry record stays the supervisor's, whose driver keeps collecting and filling lanes beside this session"
const NEXT_BESIDE = `${BESIDE}, so run no pnpm josh run:carry; act on the result by the sections below, then end the turn`

// **A drain's retrospective runs beside the driver too** (joshuafolkken/kit#7506): handed over, the
// record left the backlog unread until the session ended and the next pass re-drove, so an issue
// filed meanwhile waited on the retrospective. Beside it, the driver's re-drive dispatches that issue,
// and the session's process on the resume line holds the next `watch` back until it has ended
// (`backlog_drive_park_triage.hand_back`). The record stays this process's, so the close names it.
const BESIDE_VERDICTS: ReadonlySet<string> = new Set([TRIAGE_VERDICT, WATCH_VERDICT])

function next_move(verdict: string): string {
	if (verdict === TRIAGE_VERDICT) return NEXT_BESIDE

	if (verdict === WATCH_VERDICT) {
		return `${BESIDE}. ${backlog_drive_retrospective_unit.brief_of(String(process.pid))} Then end the turn`
	}

	const found = NEXT_BY_VERDICT.find(([prefix]) => verdict.startsWith(prefix))

	return `\nNext: ${ALREADY_CLAIMED} ${found?.[1] ?? NEXT_DEFAULT}`
}

function handoff_material(verdict: string, resume: string, details: string): string {
	const context = details === '' ? '' : `\nDetails: ${details_tail(details)}`
	const epic = verdict.startsWith('epic #')
		? '\nThe named item is an epic. Follow backlogrun-steps.md named epic procedure; do not launch the epic root as a fullrun child. After all children merge or park, record the root with pnpm josh run:carry --done <epic-number> before continuing to the next named item.'
		: ''

	const sections = `\n${run_step_section_driver.driver_sections(verdict)}`

	return `Driver result: ${verdict}\n${resume}${epic}${next_move(verdict)}${sections}${context}`
}

// A resume line the next pass could not parse is refused here rather than handed on, so neither a
// session nor the supervisor's re-drive runs with an owner or a budget nobody validated.
function judged(verdict: string, resume: string, details: string): DriveResult {
	if (!run_wake_resume.is_valid(resume)) {
		return { kind: 'failed', note: `backlog:drive returned an invalid resume line: ${resume}` }
	}

	const kind = BESIDE_VERDICTS.has(verdict) ? 'triage' : 'judgment'

	return { kind, material: handoff_material(verdict, resume, details) }
}

function driver_result(out: string, read: CarryRead, details = ''): DriveResult {
	const lines = out.split('\n')
	const verdict = lines[FIRST_LINE]

	if (is_final_stop(verdict, read)) return { kind: 'finished' }
	const resume = run_wake_resume.resume_of(out)

	if (verdict === undefined || resume === undefined) {
		return { kind: 'failed', note: `backlog:drive returned an incomplete result: ${out}` }
	}

	return judged(verdict, resume, details)
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

function read_result(result: JoshResult | undefined, target: string): DriveResult {
	if (result === undefined) return { kind: 'released' }
	if (result.code !== SUCCESS) return { kind: 'failed', note: failure_note(result) }

	return driver_result(result.out, run_carry.read_carry(target), result.err)
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
//
// **Every completed run's resume line is kept, and the re-drive runs from it** (joshuafolkken/kit#6530):
// the state an earlier child left — a park still to sort out — would otherwise be lost to a later
// child's `merge busy`. A line the re-drive cannot use ends the re-drive, and `driver_result` refuses it.
interface DrivePass {
	target: string
	carry: RunCarry
	base: ReadonlyArray<string>
	wait: Pause
}

// A `remaining` that is not a positive count is spent, so a call site that drifts from the signature
// ends the re-drive instead of running it without bound.
function rerun_args(
	pass: DrivePass,
	result: JoshResult,
	remaining: number,
): ReadonlyArray<string> | undefined {
	const is_left = remaining > 0

	if (!is_left || !is_verdict(result, RERUN_VERDICTS)) return undefined

	return run_wake_resume.resumed_args(pass.base, run_wake_resume.resume_of(result.out))
}

async function run_driver(
	pass: DrivePass,
	args: ReadonlyArray<string>,
	remaining: number,
): Promise<JoshResult | undefined> {
	const result = await josh_command.josh_run(args, true)

	run_wake_resume.remember(pass.target, pass.carry, result)
	if (is_verdict(result, [WINDOW_VERDICT])) return undefined
	const next = rerun_args(pass, result, remaining)
	if (next === undefined) return result

	await pass.wait(RERUN_PAUSE_MS)
	if (run_carry.read_carry(pass.target).kind !== 'carried') return undefined

	return await run_driver(pass, next, remaining - 1)
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

type Prepared =
	{ kind: 'failed'; note: string } | { kind: 'ready'; pass: DrivePass; args: ReadonlyArray<string> }

function refused(note: string): Prepared {
	return { kind: 'failed', note }
}

// The pass after a hand-back starts from the line the last run of this record left, if any; a kept
// line that no longer parses is a failure, never a silent fall-back to the invocation's state.
function prepare(target: string, wait: Pause): Prepared {
	const read = run_carry.read_carry(target)
	if (read.kind !== 'carried') return refused('The carry record changed.')

	const base = driver_args(read.carry.invocation)
	if (base === undefined) return refused('The carried invocation is invalid.')

	const kept = run_wake_resume.stored(target, read.carry)
	const args = kept === undefined ? base : run_wake_resume.resumed_args(base, kept)
	if (args === undefined) return refused('The kept driver resume line is invalid.')

	return { kind: 'ready', pass: { target, carry: read.carry, base, wait }, args }
}

async function drive_with(
	target: string,
	wait: Pause,
	is_parent_planning: () => boolean,
): Promise<DriveResult> {
	const prepared = prepare(target, wait)
	if (prepared.kind === 'failed') return prepared

	if (!claim_record(target, prepared.pass.carry.invocation)) {
		return { kind: 'failed', note: 'The driver could not claim the carry record.' }
	}

	await run_event_setup.emit(run_event_setup.STAGE.HANDING_OFF)

	const result = await deferred_triage(
		await run_driver(prepared.pass, prepared.args, RERUN_LIMIT),
		wait,
		is_parent_planning,
	)

	return await announced(read_result(result, target))
}

async function drive(
	target: string,
	wait: Pause = pause,
	is_parent_planning: () => boolean = never_planning,
): Promise<DriveResult> {
	return await drive_with(target, wait, is_parent_planning)
}

export const run_wake_driver = { RERUN_LIMIT, drive, driver_args, driver_result }

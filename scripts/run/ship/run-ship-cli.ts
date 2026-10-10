#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_ledger } from '#scripts/lane/lane-ledger'
import { cli_flags } from '#scripts/lib/cli-flags'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_ship, type ShipSection } from './run-ship'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_next } from './run-ship-next'
import { run_ship_pre_detach } from './run-ship-pre-detach'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_return } from './run-ship-return'
import { run_ship_stage, type Phase, type ShipState, type Stage } from './run-ship-stage'
import { run_ship_steps, type ShipArguments, type Step } from './run-ship-steps'

// `josh ship "<title> #<N>"` — one call for the fixed commit-to-report region a run ships a change on.
// It runs `gate`, `git -y`, `followup` and `run:tail` internally, so no round trip re-bills a lane's
// full context, and prints one composite report, the same way `run:tail` folds the post-merge
// bookkeeping. Each step's stderr is forwarded, so the reader still sees every explanation — a red
// check, a CI wait, a refusal — the four would have printed on their own.
//
// It stops at the first failed step: the gate must be green before the commit, the commit before the
// merge. The report ends at the failure and names the stopped step, so the run reads only that one.
//
// **Re-running it resumes rather than restarts**. Each stage's completion is
// kept in a per-issue record, and the repository's actual state — committed, pushed, merged — is read
// before the first stage, so a ship that died mid-way passes over what already happened and never
// commits, pushes or merges twice. Each stage's start, success, failure or skip goes onto the run's
// event stream. `run-ship-stage.ts` carries which stage may be passed over, and why the gate never is
// on the record's word alone.
//
// **`--review` owns the round-1 review too**: a `review` stage in front of the
// gate launches the same-strength reviewer beside it and joins, attests and records the round without
// an agent turn (`run-ship-review-steps.ts`); a High or Medium finding, or any failed join, stops there.
//
// **`--detach` hands the whole region to a supervisor that outlives the agent**:
// the agent ends at the hand-off instead of relaunching itself for the gate, a supervised ship that stops
// hands the stage back (`run-ship-return.ts`), and `--log <N>` prints the report it stopped on.
//
// The first positional is the `"<title> #<N>"` string `git -y` and `followup` already take; the issue
// number is read off its tail for `run:tail`. Any further positionals are follow-up citations filed
// this run (`fullrun-steps.md` routes branch-2 filing before `ship`), forwarded to `run:tail` after the
// closed issue so `issue:cite` reports them too. A notify body — `--notify-message` or the
// shell-body-safe `--notify-message-file` — is forwarded to `followup` alone; the completion prose is
// composed before this command and passed straight through.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const FIRST = 0
const NUMBER_GROUP = 1
const EXTRA_CITE_START = 1
// The issue reference at the tail of the title — `git -y` and `followup` read the whole string, and
// `run:tail` needs the number alone.
const TRAILING_ISSUE_PATTERN = /#([1-9]\d*)\s*$/u
// Both body forms `followup` documents, forwarded verbatim: the inline `--notify-message` and the
// shell-body-safe `--notify-message-file` a body naming a command or path must use (`followup.md`).
const NOTIFY_OPTIONS = ['notify-message', 'notify-message-file'] as const
// The PR body carrying the live-execution evidence `followup` gates the merge
// on, forwarded to `git -y` as a path because it holds commands and their output.
const BODY_FILE_OPTION = 'body-file'
const USAGE =
	'Usage: josh ship "<title> #<N>" [<follow-up-N> ...] [--cite <N> ...] [--review] [--detach] [--body-file <path>] [--notify-message <text> | --notify-message-file <path>] | josh ship --log <N>'
const NO_LOG_NOTE = 'no detached ship supervisor log for this issue'
const LANE_CHILD_DETACH_NOTE =
	'lane child: shipping through the detached supervisor (--detach implied), so the end of this turn cannot kill it'

type NotifyValues = Partial<Record<(typeof NOTIFY_OPTIONS)[number], string>>

const OPTIONS = {
	[NOTIFY_OPTIONS[0]]: { type: 'string' },
	[NOTIFY_OPTIONS[1]]: { type: 'string' },
	[BODY_FILE_OPTION]: { type: 'string' },
	review: { type: 'boolean' },
	// Hand the region to a detached supervisor (`run-ship-detach.ts`), print the
	// report a stopped supervisor left, and carry follow-up citations as options so the supervisor's
	// command line still ends with its title.
	detach: { type: 'boolean' },
	log: { type: 'string' },
	cite: { type: 'string', multiple: true },
} as const

type ShipCommand = { kind: 'ship'; args: ShipArguments } | { kind: 'log'; number: string }

// What a resumed ship knows before its first stage: the record's path (absent outside a repository),
// the stages it says completed, and the repository's actual state (`run-ship-stage.ts` decides from it).
// `started` opens with the stages the record says this attempt started — a supervisor that ended
// without a stop leaves them — and grows as each stage starts; every stage line carries it.
interface ShipContext {
	target: string | undefined
	done: ReadonlySet<string>
	state: ShipState
	started: Array<string>
}

// The notify tail `followup` takes — whichever body form the caller composed, forwarded unchanged so a
// path-based body reaches `followup` exactly as passed.
function notify_arguments(values: NotifyValues): ReadonlyArray<string> {
	return NOTIFY_OPTIONS.flatMap((option) => {
		const value = values[option]

		return value === undefined ? [] : [`--${option}`, value]
	})
}

function body_arguments(path: string | undefined): ReadonlyArray<string> {
	return path === undefined ? [] : [`--${BODY_FILE_OPTION}`, path]
}

const { PHASE } = run_ship_stage

function issue_number(title: string): string | undefined {
	return TRAILING_ISSUE_PATTERN.exec(title)?.[NUMBER_GROUP]
}

interface ParsedValues extends NotifyValues {
	[BODY_FILE_OPTION]?: string
	review?: boolean
	detach?: boolean
	log?: string
	cite?: Array<string>
}

// A follow-up citation passed as a trailing positional is a bare issue number, so a stray flag is
// refused rather than forwarded to the wrong step.
function ship_args(
	title: string,
	rest: ReadonlyArray<string>,
	values: ParsedValues,
): ShipArguments | undefined {
	const number = issue_number(title)
	const cites = [...rest, ...(values.cite ?? [])]

	if (number === undefined || cites.some((token) => !issue_number_shape.is_issue_number(token))) {
		return undefined
	}

	return {
		title,
		number,
		notify: notify_arguments(values),
		body: body_arguments(values[BODY_FILE_OPTION]),
		body_path: values[BODY_FILE_OPTION],
		cites,
		is_review: values.review === true,
		is_detach: values.detach === true,
	}
}

// `--log <N>` stands alone: a bare issue number and nothing to ship.
function log_command(number: string, positionals: ReadonlyArray<string>): ShipCommand | undefined {
	return issue_number_shape.ISSUE_NUMBER_PATTERN.test(number) && positionals.length === 0
		? { kind: 'log', number }
		: undefined
}

function command_of(
	values: ParsedValues,
	positionals: ReadonlyArray<string>,
): ShipCommand | undefined {
	if (values.log !== undefined) return log_command(values.log, positionals)

	const title = positionals[FIRST]
	const args =
		title === undefined ? undefined : ship_args(title, positionals.slice(EXTRA_CITE_START), values)

	return args === undefined ? undefined : { kind: 'ship', args }
}

// Numbers-only tail and a strict parse, so a title with no `#<N>` or a stray flag is refused rather
// than shipped past the wrong step.
function parse(argv: ReadonlyArray<string>): ShipCommand | undefined {
	const parsed = cli_flags.arguments_of(argv, OPTIONS)

	return parsed === undefined ? undefined : command_of(parsed.values, parsed.positionals)
}

// Every stage that ran is timed into the lane ledger, failed ones included — a stage that stopped the
// ship cost the lane its time as well. The append is local and best-effort, so it adds no wait.
//
// **A stage that found nothing to do is not timed**: a round 2 that was not due, a round 1 already
// recorded, or a gate that reused its tree's green record would otherwise read as a run that took a
// second and pull the stage's median to zero.
async function record_timed(step: Step, issue: string, elapsed_ms: number): Promise<void> {
	await lane_ledger.record_stage({ stage: step.stage, elapsed_ms, issue: Number(issue) })
}

async function run_step(step: Step, args: ShipArguments, state: ShipState): Promise<ShipSection> {
	const started_ms = performance.now()
	const result = await step.run(args, state)
	const elapsed_ms = performance.now() - started_ms

	if (result.is_skipped !== true) await record_timed(step, args.number, elapsed_ms)
	const section = { header: step.header, body: result.out, code: result.code }

	return result.conflicts === undefined ? section : { ...section, conflicts: result.conflicts }
}

async function emit_phase(
	args: ShipArguments,
	context: ShipContext,
	stage: Stage,
	phase: Phase,
): Promise<void> {
	const text = run_ship_stage.event_text(args.number, stage, phase, context.started)

	await run_event_stream_emit.emit(run_event_stream.EVENT_KIND.SHIP_STAGE, text)
}

// The record is written best-effort, as the event stream is: a record that could not be written costs
// a resumed ship only the state re-read, never the stage that just succeeded.
function record(target: string | undefined, write: (path: string) => void): void {
	if (target === undefined) return

	try {
		write(target)
	} catch {
		// Best-effort: the actual state is re-read on a resume, so a lost record repeats nothing.
	}
}

async function settle(
	step: Step,
	args: ShipArguments,
	context: ShipContext,
	code: number,
): Promise<void> {
	const is_green = code === SUCCESS_EXIT_CODE

	await emit_phase(args, context, step.stage, is_green ? PHASE.DONE : PHASE.FAILED)

	if (!is_green) return

	record(context.target, (path) => {
		run_ship_stage.mark_done(path, step.stage)
	})
}

// One stage: passed over when the record and the state say it is done, run and recorded otherwise.
async function run_stage(
	step: Step,
	args: ShipArguments,
	context: ShipContext,
): Promise<ShipSection> {
	if (run_ship_stage.is_done(step.stage, context.done, context.state, args.body.length > 0)) {
		await emit_phase(args, context, step.stage, PHASE.SKIPPED)

		return { header: step.header, body: run_ship.SKIPPED_BODY, code: SUCCESS_EXIT_CODE }
	}

	context.started.push(step.stage)
	record(context.target, (path) => {
		run_ship_stage.mark_started(path, step.stage)
	})
	await emit_phase(args, context, step.stage, PHASE.START)
	const section = await run_step(step, args, context.state)

	await settle(step, args, context, section.code)

	return section
}

async function open_context(args: ShipArguments): Promise<ShipContext> {
	const [target, state] = await Promise.all([
		run_ship_probe.record_target(args.number),
		run_ship_probe.read_state(),
	])

	const done = target === undefined ? new Set<string>() : run_ship_stage.read_done(target)
	const started = target === undefined ? [] : [...run_ship_stage.read_started(target)]

	return { target, done, state, started }
}

// A detached supervisor hands the stopped stage back (`run-ship-return.ts`); a
// ship in an agent's own turn has its report in front of that agent already. The `ship-stop` ends the
// attempt, so the record's started stages go with it.
async function stopped(
	sections: ReadonlyArray<ShipSection>,
	args: ShipArguments,
	step: Step,
	context: ShipContext,
): Promise<ReadonlyArray<ShipSection>> {
	if (run_ship_detach.is_supervised()) {
		const conflicts = sections.at(-1)?.conflicts
		const resume = run_ship_next.resume_of(args)

		record(context.target, run_ship_stage.end_attempt)
		await run_ship_return.return_control(
			args.number,
			step.stage,
			conflicts === undefined ? resume : { ...resume, conflicts },
		)
	}

	return sections
}

// Run the stages in order, stopping at the first that failed: a red gate never reaches the commit, so
// the returned sections end at the failure the report names. A ship that reached the end clears its
// record, so the next ship of the same issue starts from the preflight.
async function ship(args: ShipArguments): Promise<ReadonlyArray<ShipSection>> {
	const context = await open_context(args)
	const sections: Array<ShipSection> = []

	for (const step of run_ship_steps.steps(args)) {
		// eslint-disable-next-line no-await-in-loop -- stages run in order and the first failure stops the ship
		const section = await run_stage(step, args, context)

		sections.push(section)

		// eslint-disable-next-line no-await-in-loop -- stages run in order and the first failure stops the ship
		if (section.code !== SUCCESS_EXIT_CODE) return await stopped(sections, args, step, context)
	}

	record(context.target, (path) => {
		run_ship_stage.clear(path)
	})

	return sections
}

async function print_log(number: string): Promise<number> {
	const repository = await run_ship_probe.repository_directory()
	const log = repository === undefined ? undefined : run_ship_detach.read_log(repository, number)

	if (log === undefined) {
		console.error(NO_LOG_NOTE)

		return FAILURE_EXIT_CODE
	}

	console.info(log)

	return SUCCESS_EXIT_CODE
}

// The one-token contract `run:cut` keeps: the verdict on stdout, the explanation on stderr.
async function detach(args: ShipArguments): Promise<number> {
	const repository = await run_ship_probe.repository_directory()

	if (repository === undefined) {
		console.info(run_ship_detach.FAILED)

		return FAILURE_EXIT_CODE
	}

	const result = await run_ship_detach.detach({ ...args, repository, cwd: process.cwd() })

	console.error(result.note)
	console.info(result.verdict)

	return result.verdict === run_ship_detach.LAUNCHED ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

// A headless lane child's turn ending kills a ship it left in its own process,
// so inside a lane child the region always goes to the supervisor, flag or not. The supervisor itself
// inherits the lane mark, and is the one ship that must run the stages here.
function should_detach(args: ShipArguments): boolean {
	if (args.is_detach) return true

	return !run_ship_detach.is_supervised() && lane_child_marker.is_child_of(process.cwd())
}

// The preflight is deterministic and fast, so it runs here, in the agent's own turn, before the
// hand-off — a stop it finds is fixed by the same session instead of relaunching one from the
// supervisor. Only the slow stages go to the supervisor, which re-asks the preflight itself. The type
// check and the document tests follow it here for the same reason; they are not a stage, so the
// supervisor's gate runs them again rather than passing over them.
async function pre_detach_sections(args: ShipArguments): Promise<ReadonlyArray<ShipSection>> {
	const preflight = await run_stage(run_ship_steps.PREFLIGHT_STEP, args, await open_context(args))
	if (preflight.code !== SUCCESS_EXIT_CODE) return [preflight]

	const result = await run_ship_pre_detach.checks()

	return [preflight, { header: run_ship.PRE_DETACH_HEADER, body: result.out, code: result.code }]
}

async function detach_after_preflight(args: ShipArguments): Promise<number> {
	const sections = await pre_detach_sections(args)
	const code = run_ship.exit_code(sections)

	if (code === SUCCESS_EXIT_CODE) return await detach(args)

	console.info(run_ship.format_report(sections))

	return code
}

async function supervised_repository(): Promise<string | undefined> {
	return run_ship_detach.is_supervised() ? await run_ship_probe.repository_directory() : undefined
}

async function claim_supervised_identity(args: ShipArguments): Promise<void> {
	const repository = await supervised_repository()
	if (repository !== undefined) await run_ship_detach.claim_identity(repository, args.number)
}

async function record_supervised_result(
	args: ShipArguments,
	sections: ReadonlyArray<ShipSection>,
): Promise<void> {
	const repository = await supervised_repository()
	if (repository === undefined) return
	await run_ship_detach.mark_result(repository, args.number, run_ship.exit_code(sections))
}

async function run_ship_command(args: ShipArguments): Promise<number> {
	if (should_detach(args)) {
		if (!args.is_detach) console.error(LANE_CHILD_DETACH_NOTE)

		return await detach_after_preflight(args)
	}

	await claim_supervised_identity(args)
	const sections = await ship(args)

	await record_supervised_result(args, sections)
	console.info(run_ship.format_report(sections))

	return run_ship.exit_code(sections)
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const command = parse(argv)

	if (command === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return command.kind === 'log'
		? await print_log(command.number)
		: await run_ship_command(command.args)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_ship_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_ship_cli }

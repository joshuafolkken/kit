#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { run_event_stream } from './run-event-stream'
import { run_event_stream_emit } from './run-event-stream-emit'
import { run_ship, type ShipSection } from './run-ship'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_return } from './run-ship-return'
import { run_ship_review_steps } from './run-ship-review-steps'
import { run_ship_stage, type Phase, type ShipState, type Stage } from './run-ship-stage'

// `josh ship "<title> #<N>"` — one call for the fixed commit-to-report region a run ships a change on
// (joshuafolkken/kit#2398). The loop used to spend a round trip each on `gate`, `git -y`, `followup`
// and `run:tail`, re-billing a lane's full context every time; this runs the four internally and
// prints one composite report, the same way `run:tail` folds the post-merge bookkeeping. Each step's
// stderr is forwarded, so the reader still sees every explanation — a red check, a CI wait, a refusal —
// the four would have printed on their own.
//
// It stops at the first failed step: the gate must be green before the commit, the commit before the
// merge. The report ends at the failure and names the stopped step, so the run reads only that one.
//
// **Re-running it resumes rather than restarts** (joshuafolkken/kit#2426). Each stage's completion is
// kept in a per-issue record, and the repository's actual state — committed, pushed, merged — is read
// before the first stage, so a ship that died mid-way passes over what already happened and never
// commits, pushes or merges twice. Each stage's start, success, failure or skip goes onto the run's
// event stream. `run-ship-stage.ts` carries which stage may be passed over, and why the gate never is
// on the record's word alone.
//
// **`--review` owns the round-1 review too** (joshuafolkken/kit#2427): a `review` stage in front of the
// gate launches the same-strength reviewer beside it and joins, attests and records the round without
// an agent turn (`run-ship-review-steps.ts`); a High or Medium finding, or any failed join, stops there.
//
// **`--detach` hands the whole region to a supervisor that outlives the agent** (joshuafolkken/kit#2428):
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
// A follow-up citation passed as a trailing positional — a bare issue number, so a stray flag is
// refused rather than forwarded to the wrong step.
const CITE_PATTERN = /^[1-9]\d*$/u
// Both body forms `followup` documents, forwarded verbatim: the inline `--notify-message` and the
// shell-body-safe `--notify-message-file` a body naming a command or path must use (`followup.md`).
const NOTIFY_OPTIONS = ['notify-message', 'notify-message-file'] as const
// joshuafolkken/kit#2446: the PR body carrying the live-execution evidence `followup` gates the merge
// on, forwarded to `git -y` as a path because it holds commands and their output.
const BODY_FILE_OPTION = 'body-file'
const USAGE =
	'Usage: josh ship "<title> #<N>" [<follow-up-N> ...] [--cite <N> ...] [--review] [--detach] [--body-file <path>] [--notify-message <text> | --notify-message-file <path>] | josh ship --log <N>'
const NO_LOG_NOTE = 'no detached ship supervisor log for this issue'
const should_forward_stderr = true

type NotifyValues = Partial<Record<(typeof NOTIFY_OPTIONS)[number], string>>

const OPTIONS = {
	[NOTIFY_OPTIONS[0]]: { type: 'string' },
	[NOTIFY_OPTIONS[1]]: { type: 'string' },
	[BODY_FILE_OPTION]: { type: 'string' },
	review: { type: 'boolean' },
	// joshuafolkken/kit#2428: hand the region to a detached supervisor (`run-ship-detach.ts`), print the
	// report a stopped supervisor left, and carry follow-up citations as options so the supervisor's
	// command line still ends with its title.
	detach: { type: 'boolean' },
	log: { type: 'string' },
	cite: { type: 'string', multiple: true },
} as const

interface ShipArguments {
	title: string
	number: string
	notify: ReadonlyArray<string>
	body: ReadonlyArray<string>
	cites: ReadonlyArray<string>
	is_review: boolean
	is_detach: boolean
}

type ShipCommand = { kind: 'ship'; args: ShipArguments } | { kind: 'log'; number: string }

interface Step {
	stage: Stage
	header: string
	run: (args: ShipArguments, state: ShipState) => Promise<JoshResult>
}

// What a resumed ship knows before its first stage: the record's path (absent outside a repository),
// the stages it says completed, and the repository's actual state (`run-ship-stage.ts` decides from it).
interface ShipContext {
	target: string | undefined
	done: ReadonlySet<string>
	state: ShipState
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

const { STAGE, PHASE } = run_ship_stage

// The four steps in the order a change ships: the gate before the commit, the commit/push/PR before
// the merge, the merge before the report bookkeeping. The commit step carries the `--skip-*` flags a
// resumed ship needs, so an existing commit or push is never made twice.
async function josh(argv: ReadonlyArray<string>): Promise<JoshResult> {
	return await josh_command.josh_run(argv, should_forward_stderr)
}

const STEPS: ReadonlyArray<Step> = [
	{ stage: STAGE.GATE, header: run_ship.GATE_HEADER, run: async () => await josh(['gate']) },
	{
		stage: STAGE.COMMIT,
		header: run_ship.COMMIT_HEADER,
		run: async (args, state) =>
			await josh(['git', '-y', ...run_ship_stage.commit_flags(state), ...args.body, args.title]),
	},
	{
		stage: STAGE.FOLLOWUP,
		header: run_ship.FOLLOWUP_HEADER,
		run: async (args) => await josh(['followup', args.title, ...args.notify]),
	},
	{
		stage: STAGE.REPORT,
		header: run_ship.REPORT_HEADER,
		run: async (args) => await josh(['run:tail', args.number, ...args.cites]),
	},
]

// `--review` (joshuafolkken/kit#2427) puts the supervised round-1 review in front of the gate: it
// launches the gate itself, so the gate stage that follows reuses that tree's green record.
const REVIEW_STEP: Step = {
	stage: STAGE.REVIEW,
	header: run_ship.REVIEW_HEADER,
	run: async (args) => await run_ship_review_steps.review_stage(args.number),
}

function steps(args: ShipArguments): ReadonlyArray<Step> {
	return args.is_review ? [REVIEW_STEP, ...STEPS] : STEPS
}

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

function parse_values(argv: ReadonlyArray<string>): {
	values: ParsedValues
	positionals: Array<string>
} {
	return parseArgs({ args: [...argv], options: OPTIONS, allowPositionals: true, strict: true })
}

function ship_args(
	title: string,
	rest: ReadonlyArray<string>,
	values: ParsedValues,
): ShipArguments | undefined {
	const number = issue_number(title)
	const cites = [...rest, ...(values.cite ?? [])]

	if (number === undefined || cites.some((token) => !CITE_PATTERN.test(token))) return undefined

	return {
		title,
		number,
		notify: notify_arguments(values),
		body: body_arguments(values[BODY_FILE_OPTION]),
		cites,
		is_review: values.review === true,
		is_detach: values.detach === true,
	}
}

// `--log <N>` stands alone: a bare issue number and nothing to ship.
function log_command(number: string, positionals: ReadonlyArray<string>): ShipCommand | undefined {
	return CITE_PATTERN.test(number) && positionals.length === 0 ? { kind: 'log', number } : undefined
}

function read_args(argv: ReadonlyArray<string>): ShipCommand | undefined {
	const { values, positionals } = parse_values(argv)

	if (values.log !== undefined) return log_command(values.log, positionals)

	const title = positionals[FIRST]
	const args =
		title === undefined ? undefined : ship_args(title, positionals.slice(EXTRA_CITE_START), values)

	return args === undefined ? undefined : { kind: 'ship', args }
}

// Numbers-only tail and a strict parse, so a title with no `#<N>` or a stray flag is refused rather
// than shipped past the wrong step.
function parse(argv: ReadonlyArray<string>): ShipCommand | undefined {
	try {
		return read_args(argv)
	} catch {
		return undefined
	}
}

async function run_step(step: Step, args: ShipArguments, state: ShipState): Promise<ShipSection> {
	const result = await step.run(args, state)

	return { header: step.header, body: result.out, code: result.code }
}

async function emit_phase(args: ShipArguments, stage: Stage, phase: Phase): Promise<void> {
	const text = run_ship_stage.event_text(args.number, stage, phase)

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

	await emit_phase(args, step.stage, is_green ? PHASE.DONE : PHASE.FAILED)

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
		await emit_phase(args, step.stage, PHASE.SKIPPED)

		return { header: step.header, body: run_ship.SKIPPED_BODY, code: SUCCESS_EXIT_CODE }
	}

	await emit_phase(args, step.stage, PHASE.START)
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

	return { target, done, state }
}

// A detached supervisor hands the stopped stage back (`run-ship-return.ts`, joshuafolkken/kit#2428); a
// ship in an agent's own turn has its report in front of that agent already.
async function stopped(
	sections: ReadonlyArray<ShipSection>,
	args: ShipArguments,
	stage: Stage,
): Promise<ReadonlyArray<ShipSection>> {
	if (run_ship_detach.is_supervised()) await run_ship_return.return_control(args.number, stage)

	return sections
}

// Run the four in order, stopping at the first that failed: a red gate never reaches the commit, so
// the returned sections end at the failure the report names. A ship that reached the end clears its
// record, so the next ship of the same issue starts from the gate.
async function ship(args: ShipArguments): Promise<ReadonlyArray<ShipSection>> {
	const context = await open_context(args)
	const sections: Array<ShipSection> = []

	for (const step of steps(args)) {
		const section = await run_stage(step, args, context)

		sections.push(section)

		if (section.code !== SUCCESS_EXIT_CODE) return await stopped(sections, args, step.stage)
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

async function run_ship_command(args: ShipArguments): Promise<number> {
	if (args.is_detach) return await detach(args)

	const sections = await ship(args)

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

const run_ship_cli = { SUCCESS_EXIT_CODE, USAGE, main, parse, run, ship }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_ship_cli }

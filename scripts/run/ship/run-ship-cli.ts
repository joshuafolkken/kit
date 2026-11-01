#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { review_stop_log } from '#scripts/review/review-stop-log'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_ship, type ShipSection } from './run-ship'
import { run_ship_args } from './run-ship-args'
import { run_ship_body_draft } from './run-ship-body-draft'
import { run_ship_conflict_probe } from './run-ship-conflict-probe'
import { run_ship_detach } from './run-ship-detach'
import { run_ship_detach_wait } from './run-ship-detach-wait'
import { run_ship_group } from './run-ship-group'
import { run_ship_handover, type CodeCheck } from './run-ship-handover'
import { run_ship_infra_retry } from './run-ship-infra-retry'
import { run_ship_lap } from './run-ship-lap'
import { run_ship_pre_detach_pinned } from './run-ship-pre-detach-pinned'
import { run_ship_pre_detach_timed } from './run-ship-pre-detach-timed'
import { run_ship_preflight } from './run-ship-preflight'
import { run_ship_probe } from './run-ship-probe'
import { run_ship_return } from './run-ship-return'
import { run_ship_stage, type Phase, type ShipState, type Stage } from './run-ship-stage'
import { run_ship_steps, type ShipArguments, type Step } from './run-ship-steps'
import { run_ship_stop_cause } from './run-ship-stop-cause'
import { run_ship_supervised } from './run-ship-supervised'

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
// The command line it takes is read in `run-ship-args.ts`.

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh ship "<title> #<N>" [<follow-up-N> ...] [--cite <N> ...] [--review [--unpinned-ok "<reason>"]] [--detach] [--body-file <path>] [--notify-message <text> | --notify-message-file <path>] | josh ship --log <N>'
const NO_LOG_NOTE = 'no detached ship supervisor log for this issue'
const LANE_CHILD_DETACH_NOTE =
	'lane child: shipping through the detached supervisor (--detach implied), so the end of this turn cannot kill it'

// What a resumed ship knows before its first stage: the record's path (absent outside a repository),
// the stages it says completed, and the repository's actual state (`run-ship-stage.ts` decides from it).
// `started` opens with the stages the record says this attempt started — a supervisor that ended
// without a stop leaves them — and grows as each stage starts; every stage line carries it.
interface ShipContext {
	target: string | undefined
	done: ReadonlySet<string>
	state: ShipState
	started: Array<string>
	// Whether the code this process loaded has changed since it started (`run-ship-handover.ts`).
	is_stale: CodeCheck
}

interface ShipOutcome {
	sections: ReadonlyArray<ShipSection>
	is_handed_over: boolean
}

const { PHASE, STAGE } = run_ship_stage
const REREAD_AFTER: ReadonlySet<Stage> = new Set([STAGE.SYNC, STAGE.REVIEW])

// Every stage that ran is timed into the lane ledger, failed ones included — a stage that stopped the
// ship cost the lane its time as well. The append is local and best-effort, so it adds no wait.
//
// **A stage that found nothing to do is not timed**: a round 2 that was not due, a round 1 already
// recorded, or a gate that reused its tree's green record would otherwise read as a run that took a
// second and pull the stage's median to zero.
async function record_timed(step: Step, issue: string, elapsed_ms: number): Promise<void> {
	await lane_ledger_write.record_stage({ stage: step.stage, elapsed_ms, issue: Number(issue) })
}

async function run_once(step: Step, args: ShipArguments, state: ShipState): Promise<ShipSection> {
	const started_ms = performance.now()
	const result = await run_ship_lap.within(
		args.number,
		step.stage,
		async () => await step.run(args, state),
	)
	const elapsed_ms = performance.now() - started_ms

	if (result.is_skipped !== true) await record_timed(step, args.number, elapsed_ms)

	return run_ship.section_of(step.header, result)
}

// A stage that stopped on the infrastructure runs again in place before it stops the ship. A retry
// re-reads the state, as a resumed ship does: a commit whose push failed is not made a second time.
async function run_step(step: Step, args: ShipArguments, state: ShipState): Promise<ShipSection> {
	const first = [state]

	return await run_ship_infra_retry.retried(step.stage, async () => {
		const current = first.pop() ?? (await run_ship_probe.read_state())

		return await run_once(step, args, current)
	})
}

// One stage's line on the event stream, with why it ran or was skipped where the stage said.
interface StageMark {
	stage: Stage
	phase: Phase
	reason?: string | undefined
}

async function emit_phase(
	args: ShipArguments,
	context: ShipContext,
	mark: StageMark,
): Promise<void> {
	const text = run_ship_stage.event_text(args.number, mark.stage, mark.phase, context.started)

	await run_event_stream_emit.emit(
		run_event_stream.EVENT_KIND.SHIP_STAGE,
		run_ship_stage.with_reason(text, mark.reason),
	)
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
	section: ShipSection,
): Promise<void> {
	const phase = run_ship_group.settled_phase(section)

	await emit_phase(args, context, { stage: step.stage, phase, reason: section.reason })

	if (phase === PHASE.FAILED) return

	record(context.target, (path) => {
		run_ship_stage.mark_done(path, step.stage)
	})
}

// A function of its own so the write does not sit after an `await`, where `require-atomic-updates`
// reads it as a possible race — the reason `held-mark.ts` gives `set_held_mark`.
function set_state(context: ShipContext, state: ShipState): void {
	context.state = state
}

// One stage: passed over when the record and the state say it is done, run and recorded otherwise.
async function run_stage(
	step: Step,
	args: ShipArguments,
	context: ShipContext,
): Promise<ShipSection> {
	if (run_ship_stage.is_done(step.stage, context.done, context.state, args.body.length > 0)) {
		await emit_phase(args, context, { stage: step.stage, phase: PHASE.SKIPPED })

		return { header: step.header, body: run_ship.SKIPPED_BODY, code: SUCCESS_EXIT_CODE }
	}

	context.started.push(step.stage)
	record(context.target, (path) => {
		run_ship_stage.mark_started(path, step.stage)
	})
	await emit_phase(args, context, { stage: step.stage, phase: PHASE.START })
	const section = await run_step(step, args, context.state)

	await settle(step, args, context, section)
	// The sync commits locally and a review may fix the tree, so the stages after either read the state
	// anew — the commit stage then pushes the sync's commit rather than making it again.
	if (REREAD_AFTER.has(step.stage)) set_state(context, await run_ship_probe.read_state())

	return section
}

async function open_context(args: ShipArguments): Promise<ShipContext> {
	const [target, state, is_stale] = await Promise.all([
		run_ship_probe.record_target(args.number),
		run_ship_probe.read_state(),
		run_ship_handover.watch(),
	])

	const done = target === undefined ? new Set<string>() : run_ship_stage.read_done(target)
	const started = target === undefined ? [] : [...run_ship_stage.read_started(target)]

	// A supervisor that died mid-followup left its wait marked; this one waits on nothing yet.
	record(target, (path) => {
		run_ship_stage.clear_waits(path)
	})

	return { target, done, state, started, is_stale }
}

// Every stop goes to the lane ledger — supervised, in an agent's own turn, or a lane child's preflight
// before the hand-off — so `lane:stats` can say how long a ship stayed stopped for each reason. A review
// stop's deciding findings also go, whole, to the durable stop log `review:stops` reads.
async function record_stop(args: ShipArguments, stage: Stage, failed?: ShipSection): Promise<void> {
	const issue = Number(args.number)

	await lane_ledger_write.record_stop(run_ship_stop_cause.record_of(issue, stage, failed))
	review_stop_log.record({ issue, stage, findings: run_ship_stop_cause.details_of(stage, failed) })
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
	const failed = sections.at(-1)

	await record_stop(args, step.stage, failed)

	if (run_ship_detach.is_supervised()) {
		record(context.target, run_ship_stage.end_attempt)
		await run_ship_return.hand_back(args, step.stage, failed)
	}

	return sections
}

// One stage, and the outcome where the ship ends at it: a failure, or a sync after which a successor on
// the code it merged took the rest over (`run-ship-handover.ts`).
async function ship_stage(
	step: Step,
	args: ShipArguments,
	context: ShipContext,
	sections: Array<ShipSection>,
): Promise<ShipOutcome | undefined> {
	const failed = await run_ship_group.run(
		step,
		async (current) => await run_stage(current, args, context),
		sections,
	)

	if (failed !== undefined) {
		return { sections: await stopped(sections, args, failed.step, context), is_handed_over: false }
	}

	if (step.stage !== STAGE.SYNC) return undefined
	const handover = await run_ship_handover.hand_over(args, context.is_stale)

	return handover === undefined
		? undefined
		: { sections: [...sections, handover], is_handed_over: true }
}

// Run the stages in order, stopping at the first that failed: a red gate never reaches the commit, so
// the returned sections end at the failure the report names. A ship that reached the end clears its
// record, so the next ship of the same issue starts from the preflight; one handed over leaves it to
// the successor, which passes over what this one finished.
async function ship(args: ShipArguments): Promise<ShipOutcome> {
	const context = await open_context(args)
	const sections: Array<ShipSection> = []

	for (const step of run_ship_steps.steps(args)) {
		// eslint-disable-next-line no-await-in-loop -- stages run in order and the first failure stops the ship
		const outcome = await ship_stage(step, args, context, sections)

		if (outcome !== undefined) return outcome
	}

	record(context.target, (path) => {
		run_ship_stage.clear(path)
	})

	return { sections, is_handed_over: false }
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

// The verdict as its own stdout line, the explanation on stderr; a launch goes on to the wait.
async function detach(args: ShipArguments): Promise<number> {
	const repository = await run_ship_probe.repository_directory()

	if (repository === undefined) {
		console.info(run_ship_detach.FAILED)

		return FAILURE_EXIT_CODE
	}

	const result = await run_ship_detach.detach({ ...args, repository, cwd: process.cwd() })

	console.error(result.note)
	console.info(result.verdict)
	if (result.verdict !== run_ship_detach.LAUNCHED) return FAILURE_EXIT_CODE

	return await run_ship_detach_wait.after_launch(args.number)
}

// A headless lane child's turn ending kills a ship it left in its own process,
// so inside a lane child the region always goes to the supervisor, flag or not. The supervisor itself
// inherits the lane mark, and is the one ship that must run the stages here.
function should_detach(args: ShipArguments): boolean {
	if (args.is_detach) return true

	return !run_ship_detach.is_supervised() && lane_child_marker.is_child_of(process.cwd())
}

// Record the stopped pre-detach stage while preserving the report's refusal order.
async function pre_detach_stop(
	args: ShipArguments,
	stage: Stage,
	sections: ReadonlyArray<ShipSection>,
): Promise<ReadonlyArray<ShipSection>> {
	await record_stop(args, stage, sections[0])

	return sections
}

async function pre_detach_checks(
	args: ShipArguments,
	preflight: ShipSection,
): Promise<ReadonlyArray<ShipSection>> {
	const result = await run_ship_pre_detach_timed.checks(
		args.number,
		run_ship_pre_detach_pinned.checks_for(args),
	)
	const checks = { header: run_ship.PRE_DETACH_HEADER, body: result.out, code: result.code }

	if (run_ship.exit_code([checks, preflight]) !== SUCCESS_EXIT_CODE) {
		await record_stop(args, STAGE.PREFLIGHT, run_ship.with_checks(preflight, result))
	}

	return [checks, preflight]
}

// The preflight is deterministic and fast, so it runs here, in the agent's own turn, before the
// hand-off — a stop it finds is fixed by the same session instead of relaunching one from the
// supervisor. Only the slow stages go to the supervisor, which re-asks the preflight itself. The fast
// checks (`run-ship-pre-detach.ts`) follow it here for the same reason; they are not a stage, so the
// supervisor's gate runs them again rather than passing over them. They run even when the preflight
// refused, so one ship reports every failure there is to fix (joshuafolkken/kit#4305); the preflight's
// refusal still comes before its own scoped pair, the one heavy check here beside a `--review` ship's
// `test:pinned`.
//
// **The refusal is printed last**: a lane child reading the report through `tail` saw only the red
// metrics or type check after it, fixed those, and shipped into the same refusal again — every repeated
// preflight stop of joshuafolkken/kit#4478. The stop records the pre-detach checks' red beside the
// unmet kinds, so the ledger shows which refusals came with one. **Red checks behind a passed preflight
// are a stop too** (joshuafolkken/kit#5228): recorded under the preflight with their kinds, an
// `unpinned` place among them.
//
// **A conflict with origin/main stops before the checks** (joshuafolkken/kit#5018): the supervisor's
// sync would stop on it after them, so they would only be run again once it is resolved.
// A scoped failure stops before both the conflict and pinned probes: the review fix must pass its
// local checks before costly work starts (joshuafolkken/kit#5472).
async function pre_detach_sections(args: ShipArguments): Promise<ReadonlyArray<ShipSection>> {
	const preflight = await run_stage(run_ship_steps.PREFLIGHT_STEP, args, await open_context(args))

	if (preflight.preconditions?.includes(run_ship_preflight.SCOPED_PRECONDITION)) {
		return await pre_detach_stop(args, STAGE.PREFLIGHT, [preflight])
	}

	const conflict = await run_ship_conflict_probe.probe()

	if (conflict !== undefined) {
		return await pre_detach_stop(args, STAGE.SYNC, [
			run_ship.section_of(run_ship.SYNC_HEADER, conflict),
			preflight,
		])
	}

	return await pre_detach_checks(args, preflight)
}

async function detach_after_preflight(args: ShipArguments): Promise<number> {
	const sections = await pre_detach_sections(args)
	const code = run_ship.exit_code(sections)

	if (code === SUCCESS_EXIT_CODE) return await detach(args)

	console.info(run_ship.format_report(sections))

	return code
}

async function run_ship_command(given: ShipArguments): Promise<number> {
	const args = await run_ship_pre_detach_pinned.with_recorded_reason(given)

	if (should_detach(args)) {
		if (!args.is_detach) console.error(LANE_CHILD_DETACH_NOTE)

		return await detach_after_preflight(args)
	}

	await run_ship_supervised.claim_identity(args)
	const { sections, is_handed_over } = await ship(args)

	// The successor carries the same launch record, so its result is the one written there.
	if (!is_handed_over) await run_ship_supervised.record_result(args, sections)
	console.info(run_ship.format_report(sections))

	return run_ship.exit_code(sections)
}

async function run_governed(args: ShipArguments): Promise<number> {
	const printed = run_ship_supervised.print_section()

	return printed === SUCCESS_EXIT_CODE ? await run_ship_command(args) : printed
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const command = run_ship_args.parse(argv)

	if (command === undefined) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	return command.kind === 'log'
		? await print_log(command.number)
		: await run_governed(await run_ship_body_draft.with_draft(command.args))
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const run_ship_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { run_ship_cli }

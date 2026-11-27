import { derive_check } from '#scripts/document/derive-check'
import { gate_labels } from '#scripts/gate/gate-labels'
import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import type {
	ChainRefusal,
	ChainStageEntry,
	ChainStageResult,
} from '#scripts/lane/lane-ledger-schema-ship'
import { lane_ledger_write_chain_stage } from '#scripts/lane/lane-ledger-write-chain-stage'
import { run_ship_pre_detach } from '#scripts/run/ship/run-ship-pre-detach'
import { test_related_caller } from '#scripts/test/test-related-caller'
import { run_chain_reuse } from './run-chain-reuse'
import { run_review } from './run-review'

// The stage runner behind `josh run:chain` (joshuafolkken/kit#5630): the main line's chain up to the
// review in one call, not one model round trip per command. Each stage runs as its own `josh` command,
// so its report and exit code stay that command's own rather than a second wording of them. The run
// stops at the first stage that exits non-zero and prints the action after a stop there. `run:cut <N>`
// is never a stage — it is issued alone (`chain-rule.md` → "Run the review-to-merge chain").
//
// The review stages are kept apart from `main:merge` so a lane child, which merges main in ship's sync,
// runs the same list without it (joshuafolkken/kit#5625), and the half after the review is a second
// list over the same runner (joshuafolkken/kit#5735).

const SUCCESS_EXIT_CODE = 0
const COMMAND = 'pnpm josh run:chain'
const MAIN_MERGE = 'main:merge'
const SELFCHECK = 'review:selfcheck'
const CHECK_RELATED = 'check:related'
const ACCEPTANCE_CHECK = 'acceptance:check'
const PREFLIGHT_CHECK = 'preflight:check'
const EXPORTS_UNUSED = 'exports:unused'
const GUARD_TESTS = gate_labels.GUARD_TESTS_LABEL
const RUN_REVIEW = 'run:review'
const [DERIVE_CHECK = ''] = derive_check.DERIVE_CHECK_ARGV

type NextAction = (issue: string) => string

// A notice a stage that exited 0 still stops on, with the action after it, read after the stage ends
// for the issue the run is on; `undefined` lets the run go on. `refusal` names a procedural stop's
// kind for the ledger line (joshuafolkken/kit#7926).
interface HoldStop {
	notice: string
	next: NextAction
	refusal?: ChainRefusal
}

type StageHold = (issue: string) => Promise<HoldStop | undefined>

interface ChainStage {
	name: string
	argv: ReadonlyArray<string>
	// The action after a stop here, for the issue the run is on.
	next: NextAction
	hold?: StageHold
	// Runs alongside the adjacent concurrent stages: it neither writes the tree nor reads what they
	// write (joshuafolkken/kit#9140).
	concurrent?: boolean
}

interface ChainStop {
	stage: ChainStage
	code: number
	next: NextAction
	notice?: string
	refusal?: ChainRefusal
}

// A run's stop, absent when every stage ran, and each stage it ran with its start and length.
interface ChainRun {
	stop?: ChainStop
	stages: ReadonlyArray<ChainStageEntry>
}

interface TimedStage {
	entry: ChainStageEntry
	stop: ChainStop | undefined
}

type StageRunner = (argv: ReadonlyArray<string>) => Promise<JoshResult>
type Print = (text: string) => void

// `mode` is the flags that chose the list (`--join` for the half after the review).
function rerun(issue: string, from?: string, mode: ReadonlyArray<string> = []): string {
	const resume = from === undefined ? [] : ['--from', from]

	return `then rerun \`${[COMMAND, issue, ...mode, ...resume].join(' ')}\``
}

// `main:merge` prints no split notice: size is judged before implementation (joshuafolkken/kit#7009),
// so the chain goes on to the review stages without a split child (joshuafolkken/kit#6602).
const MERGE_STAGE: ChainStage = {
	name: MAIN_MERGE,
	argv: [MAIN_MERGE],
	next: (issue) =>
		`settle what \`${MAIN_MERGE}\` refused (\`chain-rule.md\` → "Orchestration facts single-sourced here"), ${rerun(issue)}`,
}

// A hand edit to a generated page stops here, before the review, rather than at the ship's pre-detach,
// which runs the same check (joshuafolkken/kit#7728). Kit alone derives pages from its command map.
const DERIVE_CHECK_STAGE: ChainStage = {
	name: DERIVE_CHECK,
	argv: derive_check.DERIVE_CHECK_ARGV,
	next: (issue) =>
		`move each named page's hand edit into its source, run \`${derive_check.DERIVE_COMMAND}\`, ${rerun(issue, DERIVE_CHECK)}`,
}

// Ship's acceptance-map refusal asked of the draft before the review, so a criterion with no row stops
// here rather than at ship's preflight (joshuafolkken/kit#7727).
const ACCEPTANCE_STAGE: ChainStage = {
	name: ACCEPTANCE_CHECK,
	argv: [ACCEPTANCE_CHECK],
	next: (issue) =>
		`write a row for each criterion it names in the ship body draft's \`## 受け入れ条件の対応\`, ${rerun(issue, ACCEPTANCE_CHECK)}`,
}

// Ship's preflight judgments that need no PR, asked through the ship's own calls before the review, so
// a classification, live-evidence, removed-tests or unplanned refusal stops here, named by its kind
// (joshuafolkken/kit#7773). The type check, `cspell:dot` and the scoped pair are `check:related`'s.
const PREFLIGHT_STAGE: ChainStage = {
	name: PREFLIGHT_CHECK,
	argv: [PREFLIGHT_CHECK],
	next: (issue) =>
		`settle each named precondition as ship's preflight would (an \`unplanned\` file: widen \`lane:plan\` or revert it), ${rerun(issue, PREFLIGHT_CHECK)}`,
}

// The pre-detach checks `check:related` does not run: `exports:unused` and the guard tests, with the
// ship's own argv (`run-ship-pre-detach.ts`), so they stop here rather than at the pre-detach. Both
// only read the tree, so they run together as the pre-detach runs them; each child's core-budget claim
// keeps the pair inside the budget.
function pre_detach_stages(): ReadonlyArray<ChainStage> {
	return [
		{
			name: EXPORTS_UNUSED,
			argv: run_ship_pre_detach.exports_argv(),
			next: (issue) => `fix each unused export it names, ${rerun(issue, EXPORTS_UNUSED)}`,
			concurrent: true,
		},
		{
			name: GUARD_TESTS,
			argv: run_ship_pre_detach.guard_test_argv(process.cwd()),
			next: (issue) => `fix the red guard test, ${rerun(issue, GUARD_TESTS)}`,
			concurrent: true,
		},
	]
}

const SELFCHECK_STAGE: ChainStage = {
	name: SELFCHECK,
	argv: [SELFCHECK],
	next: (issue) =>
		`fix each hit (\`prompts/review.md\` → "Before round 1 — the implementer's self-check"), ${rerun(issue)}; on a hit that is no defect, ${rerun(issue, CHECK_RELATED)}`,
}

// `review_args` — `--unpinned-ok "<reason>"` and `--accept-metrics "<reason>"` as given — goes to
// `run:review` alone; empty when absent. `is_kit` adds the generated-page check.
function review_stages(
	review_args: ReadonlyArray<string>,
	is_kit: boolean,
): ReadonlyArray<ChainStage> {
	return [
		SELFCHECK_STAGE,
		{
			name: CHECK_RELATED,
			argv: [CHECK_RELATED],
			next: (issue) => `fix the red check, ${rerun(issue, CHECK_RELATED)}`,
		},
		...(is_kit ? [DERIVE_CHECK_STAGE] : []),
		ACCEPTANCE_STAGE,
		PREFLIGHT_STAGE,
		...pre_detach_stages(),
		{
			name: RUN_REVIEW,
			argv: [RUN_REVIEW, ...review_args],
			next: (issue) =>
				`settle what \`${RUN_REVIEW}\` refused (only where it refused a metrics growth: add \`--accept-metrics "<why>"\`), ${rerun(issue, RUN_REVIEW)}`,
		},
	]
}

function main_line_stages(
	review_args: ReadonlyArray<string>,
	is_kit: boolean,
): ReadonlyArray<ChainStage> {
	return [MERGE_STAGE, ...review_stages(review_args, is_kit)]
}

// The stages from `from` on; `undefined` when no stage has that name.
function stages_from(
	stages: ReadonlyArray<ChainStage>,
	from: string | undefined,
): ReadonlyArray<ChainStage> | undefined {
	if (from === undefined) return stages
	const index = stages.findIndex((stage) => stage.name === from)

	return index === -1 ? undefined : stages.slice(index)
}

// The stage names its command to a `test:related` it starts, for the ledger row
// (joshuafolkken/kit#7965) — the command alone, not its arguments.
async function josh_stage(argv: ReadonlyArray<string>): Promise<JoshResult> {
	const [command = ''] = argv
	const caller = test_related_caller.environment(`run:chain ${command}`)

	return await josh_command.josh_run(argv, { should_forward_stderr: true, environment: caller })
}

async function held(stage: ChainStage, issue: string): Promise<ChainStop | undefined> {
	if (stage.hold === undefined) return undefined
	const stop = await stage.hold(issue)

	return stop === undefined ? undefined : { stage, code: SUCCESS_EXIT_CODE, ...stop }
}

// The stage's stdout is printed as it ends; stderr is forwarded as it is written. A stage with no argv
// runs no command: its hold is the check.
async function run_stage(
	stage: ChainStage,
	issue: string,
	print: Print,
	run: StageRunner,
): Promise<ChainStop | undefined> {
	if (stage.argv.length === 0) return await held(stage, issue)
	const result = await run(stage.argv)

	if (result.out !== '') print(result.out)
	if (result.code !== SUCCESS_EXIT_CODE) return { stage, code: result.code, next: stage.next }

	return await held(stage, issue)
}

// A stage whose wait was cut at the chunk with its work still running is `pending`, not a stop
// (joshuafolkken/kit#8705).
function stage_result(stop: ChainStop | undefined): ChainStageResult {
	if (stop === undefined) return 'passed'

	return stop.code === run_review.PENDING_EXIT_CODE ? 'pending' : 'stopped'
}

// One stage run and timed from its start through its hold, its `chain-stage` ledger line appended as it
// ends, so a run killed or stopped part way still leaves the stages it finished (joshuafolkken/kit#8286).
async function timed_stage(
	stage: ChainStage,
	issue: string,
	print: Print,
	run: StageRunner,
): Promise<TimedStage> {
	const started_ms = Date.now()
	const stop = await run_stage(stage, issue, print, run)
	const ended_ms = Date.now()
	const entry = {
		name: stage.name,
		at: new Date(started_ms).toISOString(),
		elapsed_ms: ended_ms - started_ms,
	}
	const result = stage_result(stop)
	// Dated at its end, as it is appended, so a long stage never stops the ledger tail's backward scan.
	const at = new Date(ended_ms).toISOString()

	await lane_ledger_write_chain_stage.record_chain_stage({
		issue: Number(issue),
		...entry,
		at,
		result,
	})

	return { entry, stop }
}

function joins(groups: ReadonlyArray<Array<ChainStage>>, stage: ChainStage): boolean {
	return stage.concurrent === true && groups.at(-1)?.[0]?.concurrent === true
}

// The stages in run order: each adjacent run of concurrent stages one group, every other stage alone.
function stage_groups(stages: ReadonlyArray<ChainStage>): ReadonlyArray<ReadonlyArray<ChainStage>> {
	const groups: Array<Array<ChainStage>> = []

	for (const stage of stages) {
		if (joins(groups, stage)) groups.at(-1)?.push(stage)
		else groups.push([stage])
	}

	return groups
}

// A group's stages run together; their output is printed in stage order once all end, so the run reads
// as it would one stage at a time.
async function timed_group(
	group: ReadonlyArray<ChainStage>,
	issue: string,
	print: Print,
	run: StageRunner,
): Promise<ReadonlyArray<TimedStage>> {
	const ran = await Promise.all(
		group.map(async (stage) => {
			const output: Array<string> = []
			const timed = await timed_stage(
				stage,
				issue,
				(text) => {
					output.push(text)
				},
				run,
			)

			return { timed, output }
		}),
	)

	const output = ran.flatMap((each) => each.output)

	for (const text of output) print(text)

	return ran.map((each) => each.timed)
}

// Each stage that ran, the stopped one included, so the run's `chain` line shows where a long run
// spent its time (joshuafolkken/kit#7736). A group's stop is its first stopped stage in stage order,
// the stop a one-at-a-time run would report.
async function run_stages(
	stages: ReadonlyArray<ChainStage>,
	issue: string,
	print: Print,
	run: StageRunner = run_chain_reuse.reusing(josh_stage),
): Promise<ChainRun> {
	const timed: Array<ChainStageEntry> = []

	for (const group of stage_groups(stages)) {
		// eslint-disable-next-line no-await-in-loop -- each group runs on the tree the earlier ones left
		const ran = await timed_group(group, issue, print, run)
		const stop = ran.find((stage) => stage.stop !== undefined)?.stop

		timed.push(...ran.map((stage) => stage.entry))
		if (stop !== undefined) return { stop, stages: timed }
	}

	return { stages: timed }
}

// The reports open with the invocation as typed (`run:chain <N>`), not an Issue citation.
function stop_report(stop: ChainStop, issue: string): string {
	const why = stop.notice ?? `exit ${String(stop.code)}`

	return `run:chain ${issue} — stopped at ${stop.stage.name} (${why})\nnext: ${stop.next(issue)}`
}

function done_report(stages: ReadonlyArray<ChainStage>, issue: string): string {
	return `run:chain ${issue} — ran ${stages.map((stage) => stage.name).join(' → ')}`
}

const run_chain = {
	SUCCESS_EXIT_CODE,
	done_report,
	main_line_stages,
	rerun,
	review_stages,
	run_stages,
	stages_from,
	stop_report,
}

export { run_chain }
export type { ChainRun, ChainStage, ChainStop, HoldStop, StageHold, StageRunner }

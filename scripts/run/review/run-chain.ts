import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import type { ChainStageEntry } from '#scripts/lane/lane-ledger-schema-ship'

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
const RUN_REVIEW = 'run:review'

type NextAction = (issue: string) => string

// A notice a stage that exited 0 still stops on, with the action after it, read after the stage ends
// for the issue the run is on; `undefined` lets the run go on.
interface HoldStop {
	notice: string
	next: NextAction
}

type StageHold = (issue: string) => Promise<HoldStop | undefined>

interface ChainStage {
	name: string
	argv: ReadonlyArray<string>
	// The action after a stop here, for the issue the run is on.
	next: NextAction
	hold?: StageHold
}

interface ChainStop {
	stage: ChainStage
	code: number
	next: NextAction
	notice?: string
}

// A run's stop, absent when every stage ran, and each stage it ran with its start and length.
interface ChainRun {
	stop?: ChainStop
	stages: ReadonlyArray<ChainStageEntry>
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

// Ship's acceptance-map refusal asked of the draft before the review, so a criterion with no row stops
// here rather than at ship's preflight (joshuafolkken/kit#7727).
const ACCEPTANCE_STAGE: ChainStage = {
	name: ACCEPTANCE_CHECK,
	argv: [ACCEPTANCE_CHECK],
	next: (issue) =>
		`write a row for each criterion it names in the ship body draft's \`## 受け入れ条件の対応\`, ${rerun(issue, ACCEPTANCE_CHECK)}`,
}

// `review_args` — `--unpinned-ok "<reason>"` and `--accept-metrics "<reason>"` as given — goes to
// `run:review` alone; empty when absent.
function review_stages(review_args: ReadonlyArray<string>): ReadonlyArray<ChainStage> {
	return [
		{
			name: SELFCHECK,
			argv: [SELFCHECK],
			next: (issue) =>
				`fix each hit (\`prompts/review.md\` → "Before round 1 — the implementer's self-check"), ${rerun(issue)}; on a hit that is no defect, ${rerun(issue, CHECK_RELATED)}`,
		},
		{
			name: CHECK_RELATED,
			argv: [CHECK_RELATED],
			next: (issue) => `fix the red check, ${rerun(issue, CHECK_RELATED)}`,
		},
		ACCEPTANCE_STAGE,
		{
			name: RUN_REVIEW,
			argv: [RUN_REVIEW, ...review_args],
			next: (issue) =>
				`settle what \`${RUN_REVIEW}\` refused (only where it refused a metrics growth: add \`--accept-metrics "<why>"\`), ${rerun(issue, RUN_REVIEW)}`,
		},
	]
}

function main_line_stages(review_args: ReadonlyArray<string>): ReadonlyArray<ChainStage> {
	return [MERGE_STAGE, ...review_stages(review_args)]
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

async function josh_stage(argv: ReadonlyArray<string>): Promise<JoshResult> {
	return await josh_command.josh_run(argv, true)
}

async function held(stage: ChainStage, issue: string): Promise<ChainStop | undefined> {
	if (stage.hold === undefined) return undefined
	const stop = await stage.hold(issue)

	return stop === undefined ? undefined : { stage, code: SUCCESS_EXIT_CODE, ...stop }
}

// The stage's stdout is printed as it ends; stderr is forwarded as it is written.
async function run_stage(
	stage: ChainStage,
	issue: string,
	print: Print,
	run: StageRunner,
): Promise<ChainStop | undefined> {
	const result = await run(stage.argv)

	if (result.out !== '') print(result.out)
	if (result.code !== SUCCESS_EXIT_CODE) return { stage, code: result.code, next: stage.next }

	return await held(stage, issue)
}

// Each stage that ran, the stopped one included, timed from its start through its hold, so the ledger
// line shows where a long run spent its time (joshuafolkken/kit#7736).
async function run_stages(
	stages: ReadonlyArray<ChainStage>,
	issue: string,
	print: Print,
	run: StageRunner = josh_stage,
): Promise<ChainRun> {
	const timed: Array<ChainStageEntry> = []

	for (const stage of stages) {
		const started_ms = Date.now()
		// eslint-disable-next-line no-await-in-loop -- each stage runs on the tree the earlier ones left
		const stop = await run_stage(stage, issue, print, run)

		timed.push({
			name: stage.name,
			at: new Date(started_ms).toISOString(),
			elapsed_ms: Date.now() - started_ms,
		})
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

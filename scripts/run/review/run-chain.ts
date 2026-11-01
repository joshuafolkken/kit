import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { split_resolution } from '#scripts/split/split-resolution'

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
const RUN_REVIEW = 'run:review'

type NextAction = (issue: string) => string

// A notice a stage that exited 0 still stops on, read after it ends for the issue the run is on;
// `undefined` lets the run go on.
interface StageHold {
	notice: (issue: string) => Promise<string | undefined>
	next: NextAction
}

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

type StageRunner = (argv: ReadonlyArray<string>) => Promise<JoshResult>
type Print = (text: string) => void

function rerun(issue: string, from?: string): string {
	const argv = from === undefined ? [issue] : [issue, '--from', from]

	return `then rerun \`${COMMAND} ${argv.join(' ')}\``
}

// `main:merge` exits 0 on its split notice, which is answered before the cut (`split-assessment.md` →
// "Over the guide before the gate"), so the chain holds on the check the cut refuses with
// (`split-unresolved`): a notice on record with neither a recorded reason nor a split child.
async function split_notice(issue: string): Promise<string | undefined> {
	return await split_resolution.ledger_refusal(Number(issue))
}

const MERGE_STAGE: ChainStage = {
	name: MAIN_MERGE,
	argv: [MAIN_MERGE],
	next: (issue) =>
		`settle what \`${MAIN_MERGE}\` refused (\`chain-rule.md\` → "Orchestration facts single-sourced here"), ${rerun(issue)}`,
	hold: {
		notice: split_notice,
		next: (issue) =>
			`answer the split notice, issue \`pnpm josh run:cut ${issue}\` alone again, ${rerun(issue, SELFCHECK)}`,
	},
}

// `--unpinned-ok "<reason>"` as given, forwarded to `run:review` alone; empty when absent.
function review_stages(unpinned_ok: ReadonlyArray<string>): ReadonlyArray<ChainStage> {
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
		{
			name: RUN_REVIEW,
			argv: [RUN_REVIEW, ...unpinned_ok],
			next: (issue) => `settle what \`${RUN_REVIEW}\` refused, ${rerun(issue, RUN_REVIEW)}`,
		},
	]
}

function main_line_stages(unpinned_ok: ReadonlyArray<string>): ReadonlyArray<ChainStage> {
	return [MERGE_STAGE, ...review_stages(unpinned_ok)]
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
	const notice = await stage.hold.notice(issue)

	return notice === undefined
		? undefined
		: { stage, code: SUCCESS_EXIT_CODE, next: stage.hold.next, notice }
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

async function run_stages(
	stages: ReadonlyArray<ChainStage>,
	issue: string,
	print: Print,
	run: StageRunner = josh_stage,
): Promise<ChainStop | undefined> {
	for (const stage of stages) {
		// eslint-disable-next-line no-await-in-loop -- each stage runs on the tree the earlier ones left
		const stop = await run_stage(stage, issue, print, run)

		if (stop !== undefined) return stop
	}

	return undefined
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
	review_stages,
	run_stages,
	stages_from,
	stop_report,
}

export { run_chain }
export type { ChainStage, ChainStop, StageHold, StageRunner }

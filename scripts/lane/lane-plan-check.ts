import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { backlog_overlap, type Clash } from '#scripts/backlog/backlog-overlap'
import { backlog_plan_comment } from '#scripts/backlog/backlog-plan-comment'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { has_any_label, IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { line_budget } from '#scripts/lines/line-budget'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { lane_plan, type LanePlan } from './lane-plan'
import { lane_yield, type YieldAt } from './lane-yield'

// The check `josh lane:plan <issue> <path>...` runs (`lane-plan-cli.ts`) — record the files a lane child
// plans to edit, and answer once whether a running lane that planned earlier declares or plans one of
// them (joshuafolkken/kit#4864).
//
// **The check happens before the first edit**, so a conflict the bodies did not show is met while the
// later lane has nothing to throw away, not at its ship. **A lane that finds a holder gives its lane
// back** rather than waiting for the holder to end (joshuafolkken/kit#4926): polling kept the seat taken
// while nothing moved, which made two lanes one. It notes its yield (`lane-yield.ts`), keeps its plan as
// yielded, releases its hold, prints `yield` and the child ends; the issue is offered again once the
// holder's lane ends. A document under `docs/` is never a clash (`backlog-overlap.ts` →
// `is_shared_document`).
//
// **`--probe` answers the same question and records nothing** (joshuafolkken/kit#5211) — no plan, no
// yield, no release. **`run:entry` gives the lane back at the entry** in a lane child, before any
// reading, on the paths dispatch gated on (`yield_at_entry`), so a holder that planned them since
// dispatch takes the lane back before the investigation the later `lane:plan` would have thrown away.

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const YIELD_EXIT_CODE = 2
const RELEASE_FLAG = '--release'
const RUNNING = new Set([IN_PROGRESS_LABEL])
const UNREAD = 'unread'
const NEAR_CAP_HEADROOM = 20

// What the overlap check found: the clash, none, or a listing it could not read.
type Probe = Clash | typeof UNREAD | undefined

function plan_of(argv: ReadonlyArray<string>, now: Date): LanePlan | undefined {
	const [issue = '', ...paths] = argv

	const claims = [...backlog_overlap.path_claims(paths)]

	if (!issue_number_shape.is_issue_number(issue) || claims.length === 0) return undefined

	return { issue: Number(issue), paths: claims, planned_at: now.toISOString() }
}

// The opted-in listing — the running lanes carry the pickup label, so it holds their bodies.
async function opted_in(): Promise<ReadonlyArray<OpenIssueData> | undefined> {
	const read = await auto_ok_cli.fetch_opted_in()

	return read.kind === 'read' ? read.issues : undefined
}

function running_of(issues: ReadonlyArray<OpenIssueData>): ReadonlyArray<OpenIssueData> {
	return issues.filter((issue) => has_any_label(issue.labels, RUNNING))
}

function clash_among(
	plan: LanePlan,
	issues: ReadonlyArray<OpenIssueData>,
	directory: string,
): Clash | undefined {
	const declared = lane_plan.with_plans(backlog_overlap.declared_of(issues), directory)

	return lane_plan.clash_of(plan, declared, directory)
}

function overlap_text(issue: number, clash: Clash): string {
	const holder = session_cite.issue(clash.holder)

	return `${session_cite.issue(issue)}'s planned \`${clash.path}\` overlaps \`${clash.claimed}\`, which ${holder} declares or plans`
}

// The yield goes on the stream before the child is told to end, so `run:merge` books it `yielded`. The
// plan is kept as yielded (`lane_plan.release`) and the child's hold released, so it can end with no
// edit; `yield` is printed last, after the release's own verdict.
async function give_back(
	plan: LanePlan,
	clash: Clash,
	directory: string,
	at: YieldAt,
): Promise<number> {
	const overlap = overlap_text(plan.issue, clash)

	lane_plan.record({ ...plan, yielded: true }, directory)
	await lane_yield.record_yield(plan.issue, overlap, at)
	await run_hold_cli.run([RELEASE_FLAG, String(plan.issue)])
	console.error(
		`${overlap}, so it gives its lane back: end the session now, with no edit — \`run:merge\` closes the lane, and the issue is offered again once that lane ends.`,
	)
	console.info('yield')

	return YIELD_EXIT_CODE
}

function clear_answer(): number {
	console.info('clear')

	return SUCCESS_EXIT_CODE
}

function clear(plan: LanePlan, directory: string): number {
	lane_plan.record({ ...plan, cleared: true, yielded: undefined }, directory)

	return clear_answer()
}

// An unread listing proves no holder absent, so it holds the edit back for one more ask.
function unread(): number {
	console.error(auto_ok_cli.UNREADABLE_MESSAGE)
	console.info('wait')

	return FAILURE_EXIT_CODE
}

// The overlap check alone, writing nothing — what `--probe` answers and `check_plan` acts on.
async function probe(plan: LanePlan, directory: string): Promise<Probe> {
	const issues = await opted_in()

	return issues === undefined ? UNREAD : clash_among(plan, running_of(issues), directory)
}

async function warn_near_cap(plan: LanePlan, directory: string): Promise<void> {
	const paths = plan.paths.map((file) => path.resolve(directory, file))
	const budgets = await line_budget.budgets_for(paths, directory)

	for (const { file_path, budget } of budgets) {
		if (budget === undefined || budget.headroom > NEAR_CAP_HEADROOM) continue

		console.error(
			`near cap: ${path.relative(directory, file_path)} (${String(budget.headroom)} lines left)`,
		)
	}
}

async function check_plan(plan: LanePlan, directory: string): Promise<number> {
	await warn_near_cap(plan, directory)
	lane_plan.record(plan, directory)
	const found = await probe(plan, directory)

	if (found === UNREAD) return unread()

	return found === undefined
		? clear(plan, directory)
		: await give_back(plan, found, directory, 'summary')
}

// `--probe`'s answer: the same tokens and exit codes as the plan's, with nothing written.
async function probe_answer(plan: LanePlan, directory: string): Promise<number> {
	const found = await probe(plan, directory)

	if (found === UNREAD) return unread()
	if (found === undefined) return clear_answer()

	console.error(`${overlap_text(plan.issue, found)}.`)
	console.info('yield')

	return YIELD_EXIT_CODE
}

// A lane that plans again — after a yield, or to add a file — keeps the place in line its first plan
// took: a fresh time would hand the files it already holds to a lane that planned after it. A yield
// stays marked until the plan clears, so a check the listing could not answer keeps the plan its lane
// yielded on.
function placed(plan: LanePlan, directory: string): LanePlan {
	const recorded = lane_plan.read(plan.issue, directory)
	if (recorded === undefined) return plan

	return { ...plan, planned_at: recorded.planned_at, yielded: recorded.yielded }
}

// The paths `issue` declares in the scope dispatch gated on — its recorded plan, else its plan comment,
// else its body (`backlog-plan-comment.ts`) — read off the same listing the probe reads the holders from.
async function entry_plan(
	issue: number,
	issues: ReadonlyArray<OpenIssueData>,
	directory: string,
): Promise<LanePlan | undefined> {
	const own = issues.filter((candidate) => candidate.number === issue)
	const declared = await backlog_plan_comment.declared_of(own, directory)
	const plan = plan_of([String(issue), ...(declared.get(issue) ?? [])], new Date())

	return plan === undefined ? undefined : placed(plan, directory)
}

async function entry_yield(
	issue: number,
	issues: ReadonlyArray<OpenIssueData>,
	directory: string,
): Promise<boolean> {
	const plan = await entry_plan(issue, issues, directory)
	const found = plan === undefined ? undefined : clash_among(plan, running_of(issues), directory)

	if (plan === undefined || found === undefined) return false

	await give_back(plan, found, directory, 'entry')

	return true
}

// **The entry probe** `run:entry` runs in a lane child before the investigation: a clash gives the lane back
// there, noted `at: entry`, the way `lane:plan` would after the summary. A clear answer, an unread
// listing or no declared path writes nothing — the later `lane:plan` still checks at the first edit.
async function yield_at_entry(issue: number, directory: string = process.cwd()): Promise<boolean> {
	const issues = await opted_in()

	return issues === undefined ? false : await entry_yield(issue, issues, directory)
}

const lane_plan_check = {
	YIELD_EXIT_CODE,
	check_plan,
	placed,
	plan_of,
	probe_answer,
	yield_at_entry,
}

export { lane_plan_check }

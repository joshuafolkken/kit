import path from 'node:path'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { backlog_overlap, type Clash } from '#scripts/backlog/backlog-overlap'
import { backlog_plan_comment } from '#scripts/backlog/backlog-plan-comment'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { line_budget } from '#scripts/lines/line-budget'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { test_declared_logic } from '#scripts/test/test-declared-logic'
import { lane_ledger_write } from './lane-ledger-write'
import { lane_plan, type LanePlan } from './lane-plan'
import { lane_plan_premise } from './lane-plan-premise'
import { lane_plan_probe } from './lane-plan-probe'
import { lane_plan_size, type Oversize } from './lane-plan-size'
import { lane_plan_wait } from './lane-plan-wait'
import { lane_plan_wait_event } from './lane-plan-wait-event'
import { lane_plan_wait_until } from './lane-plan-wait-until'
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
// **A lane dispatched before its holder, with commits, may wait instead** (joshuafolkken/kit#5986,
// `lane-plan-wait.ts`): when the holder's estimated remaining time fits the lane's own worked time, it
// keeps its seat, records the wait's deadline on its plan and prints `wait`; an ask past the deadline
// yields as above.
//
// **`--probe` answers the same question and records nothing** (joshuafolkken/kit#5211) — no plan, no
// yield, no release. **`run:entry` gives the lane back at the entry** in a lane child, before any
// reading, on the paths dispatch gated on (`yield_at_entry`), so a holder that planned them since
// dispatch takes the lane back before the investigation the later `lane:plan` would have thrown away.
//
// **A plan grown past twice its Issue's declared size answers `split`** and is not recorded
// (joshuafolkken/kit#5533, `lane-plan-size.ts`), ahead of the overlap check; so does one whose probed
// hunks or projected lines outgrow it, the axis named in the refusal and noted on the ledger
// (joshuafolkken/kit#5568). A plan declared one deliverable (`--single`) is recorded past the files axis,
// its overrun noted on the ledger for the pre-gate `run:cut` (joshuafolkken/kit#6647).

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const YIELD_EXIT_CODE = 2
const SPLIT_EXIT_CODE = 3
const PREMISE_EXIT_CODE = 4
const RELEASE_FLAG = '--release'
const NEAR_CAP_HEADROOM = 20

function plan_of(argv: ReadonlyArray<string>, now: Date): LanePlan | undefined {
	const [issue = '', ...paths] = argv

	const claims = [...backlog_overlap.path_claims(paths)]

	if (!issue_number_shape.is_issue_number(issue) || claims.length === 0) return undefined

	return { issue: Number(issue), paths: claims, planned_at: now.toISOString() }
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
	const overlap = lane_plan_probe.overlap_text(plan.issue, clash)

	lane_plan.record({ ...plan, yielded: true, waits_until: undefined }, directory)
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
	lane_plan_probe.record_cleared(plan, directory)

	return clear_answer()
}

// An unread listing proves no holder absent, so it holds the edit back for one more ask.
function unread(): number {
	console.error(auto_ok_cli.UNREADABLE_MESSAGE)
	console.info('wait')

	return FAILURE_EXIT_CODE
}

function split(plan: LanePlan, over: Oversize): number {
	console.error(lane_plan_size.refusal_text(plan.issue, over))
	console.info('split')

	return SPLIT_EXIT_CODE
}

// The refusal goes on the ledger with its axis, so `lane:stats` counts the notices by reason; the
// lines are the projection the lines axis measured, else none.
async function note(plan: LanePlan, over: Oversize): Promise<void> {
	const files = plan.paths.filter((file) => !test_declared_logic.is_test_file(file)).length
	const lines = over.reason === 'lines' ? over.measured : 0

	await lane_ledger_write.record_split_notice({
		issue: plan.issue,
		files,
		lines,
		reason: over.reason,
	})
}

// The split answer for `over`, else `undefined`. An overrun of a plan declared one deliverable, or of a
// re-plan after the lane started, is noted and passes as a warning (joshuafolkken/kit#6602).
async function refusal(plan: LanePlan, over: Oversize | undefined): Promise<number | undefined> {
	if (over === undefined) return undefined
	await note(plan, over)

	if (!lane_plan_size.is_waived(plan, over)) return split(plan, over)
	console.error(lane_plan_size.waiver_text(plan.issue, over))

	return undefined
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

// A plan the size bar judged and passed is recorded `sized`, so a yield after it keeps the bar met for the
// next run (joshuafolkken/kit#5605). An unread listing or an Issue that declares no size judged nothing,
// so the plan keeps what `placed` carried.
function sized_of(plan: LanePlan, issues: ReadonlyArray<OpenIssueData> | undefined): LanePlan {
	const is_judged = issues !== undefined && lane_plan_size.declares(plan.issue, issues)

	return is_judged ? { ...plan, sized: true } : plan
}

function held(plan: LanePlan, clash: Clash, until: string): number {
	console.error(
		`${lane_plan_probe.overlap_text(plan.issue, clash)}; this lane was dispatched first and holds commits, so it keeps its seat until ${until}: run this \`lane:plan\` again now — it waits inside, and answers \`clear\` once that lane ends, or \`yield\` past the deadline.`,
	)
	console.info('wait')

	return FAILURE_EXIT_CODE
}

// Whether no running lane holds `plan`'s files any more; an unread listing proves nothing.
async function is_free(plan: LanePlan, directory: string): Promise<boolean> {
	const issues = await lane_plan_probe.opted_in()
	const running = issues === undefined ? undefined : lane_plan_probe.running_of(issues)

	return (
		running !== undefined && lane_plan_probe.clash_among(plan, running, directory) === undefined
	)
}

// A clash yields, unless the lane waits a bounded time on a later-dispatched holder, blocking here
// (joshuafolkken/kit#5986).
async function settle(plan: LanePlan, clash: Clash, directory: string): Promise<number> {
	const until = await lane_plan_wait_until.until(plan, clash.holder)

	if (until === undefined) return await give_back(plan, clash, directory, 'summary')
	const waiting = { ...plan, waits_until: until }

	lane_plan.record(waiting, directory)
	const until_ms = Date.parse(until)
	const end = await lane_plan_wait_event.timed(
		{ issue: plan.issue, holder: clash.holder },
		async () => await lane_plan_wait.hold(until_ms, async () => await is_free(waiting, directory)),
	)

	if (end === 'free') return clear(waiting, directory)

	return end === 'expired'
		? await give_back(waiting, clash, directory, 'summary')
		: held(waiting, clash, until)
}

// A first plan whose issue's premise does not hold stops before the first edit, unrecorded
// (joshuafolkken/kit#7022); a re-plan after the lane started never re-runs them.
async function premise_stop(
	plan: LanePlan,
	issues: ReadonlyArray<OpenIssueData> | undefined,
	directory: string,
): Promise<number | undefined> {
	if (lane_plan.read(plan.issue, directory) !== undefined) return undefined
	const stop = await lane_plan_premise.stop_text(plan.issue, issues)

	if (stop === undefined) return undefined
	console.error(stop)
	console.info('premise')

	return PREMISE_EXIT_CODE
}

async function check_plan(plan: LanePlan, directory: string): Promise<number> {
	await warn_near_cap(plan, directory)
	const issues = await lane_plan_probe.opted_in()
	const refused =
		(await refusal(plan, await lane_plan_probe.oversize_of(plan, issues, directory))) ??
		(await premise_stop(plan, issues, directory))

	if (refused !== undefined) return refused
	const sized = sized_of(plan, issues)

	lane_plan.record(sized, directory)
	const found = lane_plan_probe.probe(sized, issues, directory)

	if (lane_plan_probe.is_unread(found)) return unread()

	return found === undefined ? clear(sized, directory) : await settle(sized, found, directory)
}

// `--probe`'s answer: the same tokens and exit codes as the plan's, with nothing written.
async function probe_answer(plan: LanePlan, directory: string): Promise<number> {
	const issues = await lane_plan_probe.opted_in()
	const over = await lane_plan_probe.oversize_of(plan, issues, directory)

	if (over !== undefined && !lane_plan_size.is_waived(plan, over)) return split(plan, over)
	const found = lane_plan_probe.probe(plan, issues, directory)

	if (lane_plan_probe.is_unread(found)) return unread()
	if (found === undefined) return clear_answer()

	console.error(`${lane_plan_probe.overlap_text(plan.issue, found)}.`)
	console.info('yield')

	return YIELD_EXIT_CODE
}

// A lane that plans again — after a yield, or to add a file — keeps the place in line its first plan
// took: a fresh time would hand the files it already holds to a lane that planned after it. A yield
// stays marked until the plan clears, so a check the listing could not answer keeps the plan its lane
// yielded on, and a met size bar stays met.
function placed(plan: LanePlan, directory: string): LanePlan {
	const recorded = lane_plan.read(plan.issue, directory)
	if (recorded === undefined) return plan

	return {
		...plan,
		size_approval: recorded.size_approval,
		single: plan.single ?? recorded.single,
		planned_at: recorded.planned_at,
		yielded: recorded.yielded,
		waits_until: recorded.waits_until,
		sized: lane_plan.is_sized(recorded),
	}
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
	const running = lane_plan_probe.running_of(issues)
	const found =
		plan === undefined ? undefined : lane_plan_probe.clash_among(plan, running, directory)

	if (plan === undefined || found === undefined) return false

	await give_back(plan, found, directory, 'entry')

	return true
}

// **The entry probe** `run:entry` runs in a lane child before the investigation: a clash gives the lane back
// there, noted `at: entry`, the way `lane:plan` would after the summary. A clear answer, an unread
// listing or no declared path writes nothing — the later `lane:plan` still checks at the first edit.
async function yield_at_entry(issue: number, directory: string = process.cwd()): Promise<boolean> {
	const issues = await lane_plan_probe.opted_in()

	return issues === undefined ? false : await entry_yield(issue, issues, directory)
}

const lane_plan_check = {
	PREMISE_EXIT_CODE,
	SPLIT_EXIT_CODE,
	YIELD_EXIT_CODE,
	check_plan,
	placed,
	plan_of,
	probe_answer,
	yield_at_entry,
}

export { lane_plan_check }

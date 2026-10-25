#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { backlog_overlap, type Clash } from '#scripts/backlog/backlog-overlap'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { has_any_label, IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { issue_number_shape } from '#scripts/issue/issue-number-shape'
import { session_cite } from '#scripts/issue/session-cite'
import { run_hold_cli } from '#scripts/run/hold/run-hold-cli'
import { lane_plan, type LanePlan } from './lane-plan'
import { lane_yield } from './lane-yield'

// `josh lane:plan <issue> <path>...` — record the files a lane child plans to edit, and answer once
// whether a running lane that planned earlier declares or plans one of them (joshuafolkken/kit#4864).
//
// **The check happens before the first edit**, so a conflict the bodies did not show is met while the
// later lane has nothing to throw away, not at its ship. **A lane that finds a holder gives its lane
// back** rather than waiting for the holder to end (joshuafolkken/kit#4926): polling kept the seat taken
// while nothing moved, which made two lanes one. It notes its yield (`lane-yield.ts`), keeps its plan as
// yielded, releases its hold, prints `yield` and the child ends; the issue is offered again once the
// holder's lane ends. A document under `docs/` is never a clash (`backlog-overlap.ts` →
// `is_shared_document`).

const ARGV_OFFSET = 2
const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1
const YIELD_EXIT_CODE = 2
const RELEASE_FLAG = '--release'
const USAGE = 'Usage: josh lane:plan <issue-number> <path> [<path> ...]'
const RUNNING = new Set([IN_PROGRESS_LABEL])

function plan_of(argv: ReadonlyArray<string>, now: Date): LanePlan | undefined {
	const [issue = '', ...paths] = argv

	const claims = [...backlog_overlap.path_claims(paths)]

	if (!issue_number_shape.is_issue_number(issue) || claims.length === 0) return undefined

	return { issue: Number(issue), paths: claims, planned_at: now.toISOString() }
}

// The running lanes carry the pickup label, so the opted-in listing holds their bodies.
async function running_issues(): Promise<ReadonlyArray<OpenIssueData> | undefined> {
	const read = await auto_ok_cli.fetch_opted_in()

	if (read.kind !== 'read') return undefined

	return read.issues.filter((issue) => has_any_label(issue.labels, RUNNING))
}

function clash_among(
	plan: LanePlan,
	issues: ReadonlyArray<OpenIssueData>,
	directory: string,
): Clash | undefined {
	const declared = lane_plan.with_plans(backlog_overlap.declared_of(issues), directory)
	const numbers = issues.map((issue) => issue.number)
	const holders = lane_plan.earlier_holders(plan, numbers, directory)

	return backlog_overlap.path_clash(new Set(plan.paths), declared, holders)
}

function overlap_text(issue: number, clash: Clash): string {
	const holder = session_cite.issue(clash.holder)

	return `${session_cite.issue(issue)}'s planned \`${clash.path}\` overlaps \`${clash.claimed}\`, which ${holder} declares or plans`
}

// The yield goes on the stream before the child is told to end, so `run:merge` books it `yielded`. The
// plan is kept as yielded (`lane_plan.release`) and the child's hold released, so it can end with no
// edit; `yield` is printed last, after the release's own verdict.
async function give_back(plan: LanePlan, clash: Clash, directory: string): Promise<number> {
	const overlap = overlap_text(plan.issue, clash)

	lane_plan.record({ ...plan, yielded: true }, directory)
	await lane_yield.record_yield(plan.issue, overlap)
	await run_hold_cli.run([RELEASE_FLAG, String(plan.issue)])
	console.error(
		`${overlap}, so it gives its lane back: end the session now, with no edit — \`run:merge\` closes the lane, and the issue is offered again once that lane ends.`,
	)
	console.info('yield')

	return YIELD_EXIT_CODE
}

function clear(plan: LanePlan, directory: string): number {
	lane_plan.record({ ...plan, cleared: true, yielded: undefined }, directory)
	console.info('clear')

	return SUCCESS_EXIT_CODE
}

// An unread listing proves no holder absent, so it holds the edit back for one more ask.
function unread(): number {
	console.error(auto_ok_cli.UNREADABLE_MESSAGE)
	console.info('wait')

	return FAILURE_EXIT_CODE
}

async function check_plan(plan: LanePlan, directory: string): Promise<number> {
	lane_plan.record(plan, directory)
	const issues = await running_issues()

	if (issues === undefined) return unread()
	const clash = clash_among(plan, issues, directory)

	return clash === undefined ? clear(plan, directory) : await give_back(plan, clash, directory)
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

async function run(
	argv: ReadonlyArray<string>,
	directory: string = process.cwd(),
): Promise<number> {
	const plan = plan_of(argv, new Date())

	if (plan !== undefined) return await check_plan(placed(plan, directory), directory)

	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const lane_plan_cli = { USAGE, YIELD_EXIT_CODE, run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { lane_plan_cli }

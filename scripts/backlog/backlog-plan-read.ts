import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { epic_index } from '#scripts/epic/epic-index'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { open_issue_schema, type OpenIssueData } from '#scripts/git/git-schemas'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { backlog_next, type OptedIn } from './backlog-next'
import type { PlanContext } from './backlog-plan'
import type { GateScope } from './backlog-rank'
import { backlog_scope } from './backlog-scope'

// The reads a backlog plan is drawn from — `backlog:plan`'s and `run:board`'s.
// Moved out of `backlog-plan-cli.ts` so the board places each issue through the very classification the
// plan prints, rather than a second copy of it that could promise a different order.

interface Plan {
	result: EpicNextResult
	repo: string
	exclude: ReadonlyArray<number>
	// Which **opted-in** epic is withholding which issue, narrowed by the same function the pool
	// decided membership with. Without it the scope layer had no branch for
	// "an epic is offering this one instead", so every opted-in row it could not place was reported as
	// past the listing cap. Carrying the *whole* index here instead would move that misreport rather
	// than remove it: the sentence would name an epic that is withholding nothing.
	tracked: ReadonlyMap<number, number>
	// The rows the offer's cap bounds and the paths each issue declares, so `--waves` cuts each
	// wave where `backlog:next` does.
	scope: GateScope
}

// The listing plus whether it was cut. Carried together because the rows alone cannot say whether
// what is missing from them is absent or merely past the cap.
interface OpenListing {
	rows: ReadonlyArray<OpenIssueData>
	is_capped: boolean
}

// A plan with the open listing it is rendered against.
interface PlanRead {
	plan: Plan
	listing: OpenListing
}

// The same reads and the same classification `backlog:next` makes, through the same two functions.
// `undefined` is a failure it has already reported.
async function classify(
	opted_in: OptedIn,
	exclude: ReadonlyArray<number>,
): Promise<Plan | undefined> {
	const context = await backlog_next.context_of(opted_in, exclude)

	if (context === undefined) return undefined

	const result = await backlog_next.resolve(context)

	if (result === undefined) return undefined

	return {
		result,
		repo: context.repo,
		exclude,
		tracked: epic_index.withheld_children(context.tracking.index, context.opted_in.issues),
		scope: backlog_next.gate_scope(context),
	}
}

// Every open issue, read once. It carries both halves the plan needs and the pool does not hold: the
// titles, and the set the out-of-scope rows are subtracted from. One read serves both, so the plan
// costs exactly one `gh` call more than the answer it is rendering.
async function fetch_open(): Promise<OpenListing | undefined> {
	const { json, is_capped } = await git_gh_command.issue_list_recent(auto_ok_cli.LISTING_LIMIT)

	if (json === undefined) return undefined

	const read = read_json_listing(json, open_issue_schema)

	return read.kind === 'read' ? { rows: read.rows, is_capped } : undefined
}

// A cut listing cannot say an issue is closed, only that it was not read — so the blocker filter is
// switched off rather than fed a set that would silently report standing blockers as gone.
function context_of(plan: Plan, listing: OpenListing): PlanContext {
	return {
		repo: plan.repo,
		titles: backlog_scope.titles_of(listing.rows),
		open_numbers: listing.is_capped ? undefined : backlog_scope.open_numbers_of(listing.rows),
	}
}

// The whole read, end to end, for a caller that only needs to know whether it succeeded — `run:board`
// keeps its previous plan on `undefined` rather than drawing an empty one.
async function with_listing(plan: Plan | undefined): Promise<PlanRead | undefined> {
	if (plan === undefined) return undefined

	const listing = await fetch_open()

	return listing === undefined ? undefined : { plan, listing }
}

async function read_plan(exclude: ReadonlyArray<number> = []): Promise<PlanRead | undefined> {
	const opted_in = await auto_ok_cli.fetch_opted_in()

	if (opted_in.kind !== 'read') return undefined

	return await with_listing(await classify(opted_in, exclude))
}

const backlog_plan_read = { classify, context_of, fetch_open, read_plan }

export { backlog_plan_read }
export type { OpenListing, Plan, PlanRead }

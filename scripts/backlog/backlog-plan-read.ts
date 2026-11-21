import { auto_ok_cli } from '#scripts/auto-ok/auto-ok-cli'
import { epic_index } from '#scripts/epic/epic-index'
import type { EpicNextResult } from '#scripts/epic/epic-report'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { open_issue_schema, type OpenListing } from '#scripts/git/git-schemas'
import { read_json_listing } from '#scripts/git/parse-json-array'
import { issue_sample_prime } from '#scripts/issue/issue-sample-prime'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { launch_timing } from '#scripts/lane/launch-timing'
import { backlog_gate_scope, type OptedIn, type PoolContext } from './backlog-gate-scope'
import { backlog_next } from './backlog-next'
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
	// The first open epic, opted in or not, that lists each child (`epic_index.first_epics`): the epic a
	// pending row's publication step names. Absent, a plan knows only `tracked`.
	epics?: ReadonlyMap<number, number> | undefined
	// The rows the offer's cap bounds and the paths each issue declares, so `--waves` separates each
	// wave as `backlog:next` does — and the lane limit it cuts each wave at.
	scope: GateScope
}

// A plan with the open listing it is rendered against.
interface PlanRead {
	plan: Plan
	listing: OpenListing
}

// The open listing, or why it was not read.
interface OpenListingRead {
	listing: OpenListing | undefined
	error?: string | undefined
}

// The lane limit a wave is cut at, capped at the port seats as a launch is; `undefined` when the
// limit cannot be read, so the plan stays drawable and says it is uncapped.
async function read_wave_limit(): Promise<number | undefined> {
	const choice = await lane_capacity.lane_limit()

	return choice.kind === 'limit' ? lane_capacity.seated_limit(choice.limit) : undefined
}

async function scope_of(context: PoolContext): Promise<GateScope> {
	const scope = await launch_timing.timed(
		'plan: gate scope',
		async () => await backlog_gate_scope.gate_scope(context),
	)

	return { ...scope, wave_limit: await launch_timing.timed('plan: wave limit', read_wave_limit) }
}

// The same reads and the same classification `backlog:next` makes, through the same two functions.
// `undefined` is a failure it has already reported. Each step is timed under a `plan:` phase for
// `run:board --timing` (joshuafolkken/kit#8218); timing only records, so the plan is the same.
// The gate scope reads only the context, not the resolution, so the two run side by side
// (joshuafolkken/kit#8220). `open` is the whole open listing the caller holds, which answers the epics.
async function classify(
	opted_in: OptedIn,
	exclude: ReadonlyArray<number>,
	open?: OpenListing,
): Promise<Plan | undefined> {
	const context = await launch_timing.timed(
		'plan: context',
		async () => await backlog_next.context_of(opted_in, exclude, open),
	)

	if (context === undefined) return undefined

	const [result, scope] = await Promise.all([
		launch_timing.timed('plan: resolve', async () => await backlog_next.resolve(context)),
		scope_of(context),
	])

	if (result === undefined) return undefined

	return {
		result,
		repo: context.repo,
		exclude,
		tracked: epic_index.withheld_children(context.tracking.index, context.opted_in.issues),
		epics: epic_index.first_epics(context.tracking.index),
		scope,
	}
}

// Every open issue, read once. It carries both halves the plan needs and the pool does not hold: the
// titles, and the set the out-of-scope rows are subtracted from. One read serves both, so the plan
// costs exactly one `gh` call more than the answer it is rendering.
// `error` is gh's reason when the listing was not read at all, so `run:board` can name what a person
// fixes (joshuafolkken/kit#8507); a listing read but not parsed carries none.
async function read_open(): Promise<OpenListingRead> {
	const { json, is_capped, error } = await git_gh_command.issue_list_recent(
		auto_ok_cli.LISTING_LIMIT,
	)

	if (json === undefined) return { listing: undefined, error }

	const read = read_json_listing(json, open_issue_schema)

	if (read.kind !== 'read') return { listing: undefined }
	await issue_sample_prime.prime(read.rows.map((row) => row.body))

	return { listing: { rows: read.rows, is_capped } }
}

async function fetch_open(): Promise<OpenListing | undefined> {
	const { listing } = await read_open()

	return listing
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
// keeps its previous plan on `undefined` rather than drawing an empty one. The opted-in pool and the open
// listing take nothing from each other, so they are read side by side, and the listing is handed to the
// classification so the epics are not read a second time (joshuafolkken/kit#8220).
async function read_plan(exclude: ReadonlyArray<number> = []): Promise<PlanRead | undefined> {
	const [opted_in, listing] = await Promise.all([auto_ok_cli.fetch_opted_in(), fetch_open()])

	if (listing === undefined || opted_in.kind !== 'read') return undefined

	const plan = await classify(opted_in, exclude, listing)

	return plan === undefined ? undefined : { plan, listing }
}

const backlog_plan_read = { classify, context_of, fetch_open, read_open, read_plan }

export { backlog_plan_read }
export type { Plan, PlanRead }

export { type OpenListing } from '#scripts/git/git-schemas'

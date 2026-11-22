import { auto_ok_cli, type OptedInRead } from '#scripts/auto-ok/auto-ok-cli'
import type { OptedIn } from '#scripts/backlog/backlog-gate-scope'
import { backlog_plan, type NamedPlan } from '#scripts/backlog/backlog-plan'
import { backlog_plan_read, type OpenListing, type Plan } from '#scripts/backlog/backlog-plan-read'
import { backlog_waves } from '#scripts/backlog/backlog-waves'
import { epic_classify } from '#scripts/epic/epic-classify'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { gh_request_tally, type CallCount } from '#scripts/gh/gh-request-tally'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { launch_timing } from '#scripts/lane/launch-timing'
import { run_board_decision_read } from './run-board-decision-read'
import { run_board_human_merge } from './run-board-human-merge'
import { run_board_layout, type BoardPlan } from './run-board-layout'

// The plan `run:board` lays the run over, scoped to what the run was asked to do.
// **`--only`** draws the named issues alone — a named epic expanded into its children; **a named prefix
// without it** draws the named issues first and the opted-in waves after them; **nothing named** draws the
// opted-in waves. The named issues are classified through the very function `backlog:next`
// places the pool with, fed as an opted-in set of their own, so an epic is expanded the way the run
// expands it and no second placement exists to disagree with it.

// Counts, not ms, under the `--timing` report's ms heading — the name says so. They count the window,
// not the plan alone: the thread-wide tally also takes the calls other board reads send concurrently.
const GH_CALLS_PHASE = 'gh calls during plan read (count)'
const GH_NOT_MODIFIED_PHASE = 'gh 304 during plan read (count)'

// The reads the plan is drawn from, a seam so each scope is tested without GitHub.
interface PlanPorts {
	fetch_open: () => Promise<OpenListing | undefined>
	fetch_opted_in: () => Promise<OptedInRead>
	classify: (
		opted_in: OptedIn,
		exclude: ReadonlyArray<number>,
		open: OpenListing,
	) => Promise<Plan | undefined>
}

// The board leads a row withheld for a person with 🙋, so classifying says no ❗ notice over it.
async function classify_quietly(
	opted_in: OptedIn,
	exclude: ReadonlyArray<number>,
	open: OpenListing,
): Promise<Plan | undefined> {
	epic_classify.mute_notices()

	return await backlog_plan_read.classify(opted_in, exclude, open)
}

// The live listing rejects with gh's reason, so the board's fetch carries it into `plan_error` and the
// notice slot names what a person fixes (`gh auth login`, `gh not found`; joshuafolkken/kit#8507).
// A listing read but not parsed stays `undefined`: the board keeps its plan and retries.
async function fetch_open_or_reason(): Promise<OpenListing | undefined> {
	const { listing, error } = await backlog_plan_read.read_open()

	if (error !== undefined) throw new Error(error)

	return listing
}

const LIVE_PORTS: PlanPorts = {
	fetch_open: fetch_open_or_reason,
	fetch_opted_in: auto_ok_cli.fetch_opted_in,
	classify: classify_quietly,
}

// One classified plan, against the listing it was read with, and the opted-in pool read beside it —
// `undefined` when the scope draws no pool.
interface PlanRead {
	listing: OpenListing
	pool: OptedInRead | undefined
	ports: PlanPorts
}

// A row the listing read without its labels is left out, so it reads as unknown rather than unlabelled.
function labels_of(rows: ReadonlyArray<OpenIssueData>): ReadonlyMap<number, ReadonlyArray<string>> {
	const labelled = rows.flatMap((row) =>
		row.labels === undefined ? [] : [[row.number, row.labels.map((label) => label.name)] as const],
	)

	return new Map(labelled)
}

async function board_of(
	opted_in: OptedIn,
	exclude: ReadonlyArray<number>,
	read: PlanRead,
): Promise<BoardPlan | undefined> {
	const plan = await read.ports.classify(opted_in, exclude, read.listing)

	if (plan === undefined) return undefined

	return {
		waves: backlog_waves.build(plan.result, plan.repo, plan.scope),
		tracked: plan.tracked,
		epics: plan.epics,
		context: backlog_plan_read.context_of(plan, read.listing),
		labels: labels_of(read.listing.rows),
		declared: plan.scope.declared,
		withheld: new Set(plan.result.blocked_on_people.map((child) => child.number)),
	}
}

async function pool_board(
	exclude: ReadonlyArray<number>,
	read: PlanRead,
): Promise<BoardPlan | undefined> {
	const { pool } = read

	return pool?.kind === 'read' ? await board_of(pool, exclude, read) : undefined
}

// The named issues as the open listing holds them — a closed one is the stream's to show, not the plan's.
async function named_board(named: NamedPlan, read: PlanRead): Promise<BoardPlan | undefined> {
	const issues = read.listing.rows.filter((row) => named.issues.includes(row.number))

	return await board_of({ kind: 'read', issues, cutoff: 'none' }, [], read)
}

function not_held(children: ReadonlyArray<EpicChild>, held: ReadonlySet<number>): Array<EpicChild> {
	return children.filter((child) => !held.has(child.number))
}

// The issues the pool runs: its waves and its running issues, not what it leaves unreached.
function runs_of(pool: BoardPlan): ReadonlySet<number> {
	const running = pool.waves.running ?? []

	return new Set([...pool.waves.waves.flat(), ...running].map((child) => child.number))
}

// The named plan is classified alone, so a blocker only the pool holds reads as outside it; the
// child still waits on a person only while a standing blocker is one the pool does not run.
function waits_outside(child: EpicChild, pool: BoardPlan, runs: ReadonlySet<number>): boolean {
	const { context } = pool

	return child.blocked_by.some(
		(edge) =>
			backlog_plan.is_standing(edge, context) &&
			!(edge.repo === context.repo && runs.has(edge.number)),
	)
}

function lead_withheld(lead: BoardPlan, pool: BoardPlan): Array<number> {
	const runs = runs_of(pool)
	const children = [...lead.waves.waves.flat(), ...lead.waves.unreached]
	const freed = children.filter((child) => !waits_outside(child, pool, runs))
	const freed_numbers = new Set(freed.map((child) => child.number))

	return [...(lead.withheld ?? [])].filter((number) => !freed_numbers.has(number))
}

// The named plan's withheld issues the pool does not free, and the pool's the named plan does not hold.
function withheld_of(lead: BoardPlan, pool: BoardPlan, held: ReadonlySet<number>): Set<number> {
	const from_pool = [...(pool.withheld ?? [])].filter((number) => !held.has(number))

	return new Set([...lead_withheld(lead, pool), ...from_pool])
}

// One map from the pool's and the named plan's, the named plan's entry winning a shared key.
function merged<Value>(
	pool: ReadonlyMap<number, Value> | undefined,
	lead: ReadonlyMap<number, Value> | undefined,
): Map<number, Value> {
	return new Map([...(pool ?? []), ...(lead ?? [])])
}

// The named waves lead and the pool's follow, a child the named plan already holds left out of the pool
// so a named epic's children are not drawn twice.
function joined(lead: BoardPlan, pool: BoardPlan): BoardPlan {
	const held = run_board_layout.numbers_of(lead)

	return {
		waves: {
			waves: [...lead.waves.waves, ...pool.waves.waves.map((wave) => not_held(wave, held))],
			unreached: [...lead.waves.unreached, ...not_held(pool.waves.unreached, held)],
			running: [...(lead.waves.running ?? []), ...not_held(pool.waves.running ?? [], held)],
		},
		tracked: merged(pool.tracked, lead.tracked),
		epics: merged(pool.epics, lead.epics),
		context: pool.context,
		labels: pool.labels,
		declared: merged(pool.declared, lead.declared),
		withheld: withheld_of(lead, pool, held),
	}
}

async function scoped_board(named: NamedPlan, read: PlanRead): Promise<BoardPlan | undefined> {
	const lead = await named_board(named, read)

	if (lead === undefined || named.only) return lead

	const pool = await pool_board(named.issues, read)

	return pool === undefined ? undefined : joined(lead, pool)
}

// The pool, read only when the scope draws it: an `--only` run names its issues and draws no pool.
async function read_pool(named: NamedPlan, ports: PlanPorts): Promise<OptedInRead | undefined> {
	if (named.only && named.issues.length > 0) return undefined

	return await launch_timing.timed('plan: pool', ports.fetch_opted_in)
}

// The open listing and the pool take nothing from each other, so they are read side by side
// (joshuafolkken/kit#8220).
async function read_steps(named: NamedPlan, ports: PlanPorts): Promise<BoardPlan | undefined> {
	const [listing, pool] = await Promise.all([
		launch_timing.timed('plan: list', ports.fetch_open),
		read_pool(named, ports),
	])

	if (listing === undefined || listing.rows.length === 0) return undefined

	const read = { listing, pool, ports }

	const plan =
		named.issues.length === 0 ? await pool_board([], read) : await scoped_board(named, read)
	const decided = await launch_timing.timed(
		'plan: decisions',
		async () => await run_board_decision_read.with_decisions(plan),
	)

	// The pull requests are paired after the decisions, so a blocker the 🙋 section draws is paired too.
	return await launch_timing.timed(
		'plan: prs',
		async () => await run_board_human_merge.with_prs(decided),
	)
}

// The `gh` calls sent while the plan was read and how many GitHub answered 304, counted as `--timing`
// phases (joshuafolkken/kit#8218). The rate-limit, thanks and closed reads running beside it in the
// same thread are included.
function mark_calls(before: CallCount): void {
	const after = gh_request_tally.snapshot()

	launch_timing.mark(GH_CALLS_PHASE, after.calls - before.calls)
	launch_timing.mark(GH_NOT_MODIFIED_PHASE, after.not_modified - before.not_modified)
}

// `undefined` is a failed read, which the board answers by keeping the plan it already has.
// An empty listing is one too: the board is read while its own run's issues are open, and an empty one
// drew every live child finished and the pool empty (joshuafolkken/kit#4537). The guard is the board's
// alone — `backlog:plan` in a repository with no open issue reads an empty listing correctly.
// Each step is timed under a `plan:` phase; `launch_timing` keeps the first read's.
async function read_plan(
	named: NamedPlan,
	ports: PlanPorts = LIVE_PORTS,
): Promise<BoardPlan | undefined> {
	const before = gh_request_tally.snapshot()

	try {
		return await read_steps(named, ports)
	} finally {
		mark_calls(before)
	}
}

const run_board_plan = { GH_CALLS_PHASE, GH_NOT_MODIFIED_PHASE, fetch_open_or_reason, read_plan }

export { run_board_plan }
export type { PlanPorts }

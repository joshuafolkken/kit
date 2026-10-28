import { auto_ok_cli, type OptedInRead } from '#scripts/auto-ok/auto-ok-cli'
import type { OptedIn } from '#scripts/backlog/backlog-gate-scope'
import { backlog_plan, type NamedPlan } from '#scripts/backlog/backlog-plan'
import { backlog_plan_read, type OpenListing, type Plan } from '#scripts/backlog/backlog-plan-read'
import { backlog_waves } from '#scripts/backlog/backlog-waves'
import { epic_classify } from '#scripts/epic/epic-classify'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { run_board_layout, type BoardPlan } from './run-board-layout'

// The plan `run:board` lays the run over, scoped to what the run was asked to do.
// **`--only`** draws the named issues alone — a named epic expanded into its children; **a named prefix
// without it** draws the named issues first and the opted-in waves after them; **nothing named** draws the
// opted-in waves. The named issues are classified through the very function `backlog:next`
// places the pool with, fed as an opted-in set of their own, so an epic is expanded the way the run
// expands it and no second placement exists to disagree with it.

// The reads the plan is drawn from, a seam so each scope is tested without GitHub.
interface PlanPorts {
	fetch_open: () => Promise<OpenListing | undefined>
	fetch_opted_in: () => Promise<OptedInRead>
	classify: (opted_in: OptedIn, exclude: ReadonlyArray<number>) => Promise<Plan | undefined>
}

// The board leads a row withheld for a person with 🙋, so classifying says no ❗ notice over it.
async function classify_quietly(
	opted_in: OptedIn,
	exclude: ReadonlyArray<number>,
): Promise<Plan | undefined> {
	epic_classify.mute_notices()

	return await backlog_plan_read.classify(opted_in, exclude)
}

const LIVE_PORTS: PlanPorts = {
	fetch_open: backlog_plan_read.fetch_open,
	fetch_opted_in: auto_ok_cli.fetch_opted_in,
	classify: classify_quietly,
}

// One classified plan, against the listing it was read with.
interface PlanRead {
	listing: OpenListing
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
	const plan = await read.ports.classify(opted_in, exclude)

	if (plan === undefined) return undefined

	return {
		waves: backlog_waves.build(plan.result, plan.repo, plan.scope),
		tracked: plan.tracked,
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
	const opted_in = await read.ports.fetch_opted_in()

	return opted_in.kind === 'read' ? await board_of(opted_in, exclude, read) : undefined
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
		tracked: new Map([...pool.tracked, ...lead.tracked]),
		context: pool.context,
		labels: pool.labels,
		declared: new Map([...(pool.declared ?? []), ...(lead.declared ?? [])]),
		withheld: withheld_of(lead, pool, held),
	}
}

async function scoped_board(named: NamedPlan, read: PlanRead): Promise<BoardPlan | undefined> {
	const lead = await named_board(named, read)

	if (lead === undefined || named.only) return lead

	const pool = await pool_board(named.issues, read)

	return pool === undefined ? undefined : joined(lead, pool)
}

// `undefined` is a failed read, which the board answers by keeping the plan it already has.
// An empty listing is one too: the board is read while its own run's issues are open, and an empty one
// drew every live child finished and the pool empty (joshuafolkken/kit#4537). The guard is the board's
// alone — `backlog:plan` in a repository with no open issue reads an empty listing correctly.
async function read_plan(
	named: NamedPlan,
	ports: PlanPorts = LIVE_PORTS,
): Promise<BoardPlan | undefined> {
	const listing = await ports.fetch_open()

	if (listing === undefined || listing.rows.length === 0) return undefined

	const read = { listing, ports }

	return named.issues.length === 0 ? await pool_board([], read) : await scoped_board(named, read)
}

const run_board_plan = { read_plan }

export { run_board_plan }
export type { PlanPorts }

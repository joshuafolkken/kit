import { auto_ok_cli, type OptedInRead } from '#scripts/auto-ok/auto-ok-cli'
import type { OptedIn } from '#scripts/backlog/backlog-next'
import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import { backlog_plan_read, type OpenListing, type Plan } from '#scripts/backlog/backlog-plan-read'
import { backlog_waves } from '#scripts/backlog/backlog-waves'
import type { EpicChild } from '#scripts/epic/epic-graph'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import type { BoardPlan } from './run-board-layout'

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

const LIVE_PORTS: PlanPorts = {
	fetch_open: backlog_plan_read.fetch_open,
	fetch_opted_in: auto_ok_cli.fetch_opted_in,
	classify: backlog_plan_read.classify,
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

function children_of(plan: BoardPlan): Array<EpicChild> {
	return [...plan.waves.waves.flat(), ...plan.waves.unreached]
}

function not_held(children: ReadonlyArray<EpicChild>, held: ReadonlySet<number>): Array<EpicChild> {
	return children.filter((child) => !held.has(child.number))
}

// The named waves lead and the pool's follow, a child the named plan already holds left out of the pool
// so a named epic's children are not drawn twice.
function joined(lead: BoardPlan, pool: BoardPlan): BoardPlan {
	const held = new Set(children_of(lead).map((child) => child.number))

	return {
		waves: {
			waves: [...lead.waves.waves, ...pool.waves.waves.map((wave) => not_held(wave, held))],
			unreached: [...lead.waves.unreached, ...not_held(pool.waves.unreached, held)],
		},
		tracked: new Map([...pool.tracked, ...lead.tracked]),
		context: pool.context,
		labels: pool.labels,
	}
}

async function scoped_board(named: NamedPlan, read: PlanRead): Promise<BoardPlan | undefined> {
	const lead = await named_board(named, read)

	if (lead === undefined || named.only) return lead

	const pool = await pool_board(named.issues, read)

	return pool === undefined ? undefined : joined(lead, pool)
}

// `undefined` is a failed read, which the board answers by keeping the plan it already has.
async function read_plan(
	named: NamedPlan,
	ports: PlanPorts = LIVE_PORTS,
): Promise<BoardPlan | undefined> {
	const listing = await ports.fetch_open()

	if (listing === undefined) return undefined

	const read = { listing, ports }

	return named.issues.length === 0 ? await pool_board([], read) : await scoped_board(named, read)
}

const run_board_plan = { read_plan }

export { run_board_plan }
export type { PlanPorts }

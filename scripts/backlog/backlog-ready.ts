import { josh_command, type JoshResult } from '#scripts/josh/josh-run'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { lane_registry } from '#scripts/lane/lane-registry'
import type { RunCarry } from '#scripts/run/run-carry'
import { run_headless } from '#scripts/run/run-headless'
import { run_invocation } from '#scripts/run/run-invocation'
import { backlog_stalled } from './backlog-stalled'

// The ready line reports runnable work to the driving backlogrun parent on a watcher wake.

const NO_FREE = 0
const NONE = 0

interface ReadyReading {
	issues: ReadonlyArray<string>
	free_lanes: number
}

interface ReadyPorts {
	free_lane_count: () => Promise<number>
	ready_issues: () => Promise<ReadonlyArray<string>>
}

// Free lanes right now: the limit less the live lanes. An unreadable limit reads as no free lane — the
// safe direction, since both the stall and the ready line need a free lane and reporting one that is
// not there is the false positive neither may raise.
//
// **Occupancy is the local worktree count, not the dispatch budget's busy read.** `epic-lane-offer`
// measures occupancy with `epic_busy.occupied_lanes`, a network read of in-progress issue labels; this
// counts live worktrees instead, deliberately — it runs on the cheap-first path where the costly read
// (`backlog:next`) is gated behind a free lane, so a network read here would defeat that design. The
// two can diverge, but only toward over-counting live lanes → fewer free lanes, the safe direction.
async function free_lane_count(): Promise<number> {
	const limit = lane_capacity.lane_limit()

	if (limit.kind !== 'limit') return NO_FREE

	const lanes = await lane_registry.list_lanes()
	const live = lanes.filter((lane) => !lane.is_stranded).length

	return lane_capacity.free_lanes(limit.limit, live)
}

// **A `--only` run has no pool to drain** (joshuafolkken/kit#2472). `backlog:next` lists the opted-in
// pool, and a `--only` run's work is its named list — issues and epics that run in order through their
// own step, never through the pick-up ask — so a ready pool issue is neither a stall nor an ask it owes.
// Without a `--only` record the pool is the run's, whole.
function drains_pool(carry: RunCarry | undefined): boolean {
	return carry === undefined || !run_invocation.has_only(carry.invocation)
}

// The `backlog:next` read, or `undefined` for a `--only` run, which answers none before paying for the
// network read. A bounded read (joshuafolkken/kit#2503) keeps stderr piped: the arrival probe reads once
// a minute, and a forwarded refusal would fill the watcher's output.
async function read_backlog_next(timeout_ms?: number): Promise<JoshResult | undefined> {
	if (!drains_pool(await run_headless.current_carry())) return undefined

	return await josh_command.josh_run(['backlog:next'], timeout_ms === undefined, timeout_ms)
}

// The runnable issues for this checkout, read the way a loop reads them: `backlog:next`'s numeric lines.
async function ready_issues(): Promise<ReadonlyArray<string>> {
	const result = await read_backlog_next()

	return result === undefined ? [] : backlog_stalled.ready_tokens(result.out)
}

const DEFAULT_PORTS: ReadyPorts = { free_lane_count, ready_issues }

// Cheap first: a full pool answers without the network read, since ready work with nowhere to go is not
// a pick-up.
async function read_ready(ports: ReadyPorts = DEFAULT_PORTS): Promise<ReadyReading> {
	const free_lanes = await ports.free_lane_count()

	if (free_lanes <= NO_FREE) return { issues: [], free_lanes }

	return { issues: await ports.ready_issues(), free_lanes }
}

// `undefined` unless there is both runnable work and a lane for it — the only state worth a line.
function ready_line(reading: ReadyReading): string | undefined {
	if (reading.issues.length === NONE || reading.free_lanes <= NO_FREE) return undefined

	const issues = reading.issues.map((issue) => `#${issue}`).join(' ')

	return `ready ${issues} · free lanes ${String(reading.free_lanes)}`
}

// The watcher's line on exit, for the driving parent alone — a `fullrun` watcher has no pool to pick
// from. Best-effort: a reading that fails prints nothing rather than failing the watcher whose exit is
// the wake.
async function parent_ready_line(
	ports: ReadyPorts,
	is_parent: () => Promise<boolean>,
): Promise<string | undefined> {
	if (!(await is_parent())) return undefined

	return ready_line(await read_ready(ports))
}

async function print_ready_line(
	ports: ReadyPorts = DEFAULT_PORTS,
	is_parent: () => Promise<boolean> = run_headless.is_backlog_parent,
): Promise<void> {
	try {
		const line = await parent_ready_line(ports, is_parent)

		if (line !== undefined) console.info(line)
	} catch {
		// A pick-up line is a hint; the wake it rides must still be delivered.
	}
}

// The line `epic --add` prints once a child entered an epic while a `backlogrun` parent drives this
// checkout: a filing made mid-run joins the pool the moment it is placed, so the parent asks now rather
// than on the next wake (joshuafolkken/kit#2452). The recommendation commands (`issue:scout`,
// `epic:bundle`) carry none — before the insertion the child is in no pool the ask could find.
const OFFER_HINT =
	'↻ backlogrun parent: a child just entered an epic — run `pnpm josh backlog:offer` next, so a ' +
	'runnable filing is dispatched now rather than on the next wake.'

async function print_offer_hint(
	is_parent: () => Promise<boolean> = run_headless.is_backlog_parent,
): Promise<void> {
	try {
		if (await is_parent()) console.info(OFFER_HINT)
	} catch {
		// A hint that cannot read the carry record says nothing; the insertion itself has landed.
	}
}

const backlog_ready = {
	DEFAULT_PORTS,
	OFFER_HINT,
	read_backlog_next,
	print_offer_hint,
	free_lane_count,
	drains_pool,
	print_ready_line,
	read_ready,
	ready_issues,
	ready_line,
}

export { backlog_ready }
export type { ReadyPorts, ReadyReading }

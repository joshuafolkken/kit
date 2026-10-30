import { git_gh_command } from '#scripts/gh/git-gh-command'
import { issue_cite } from '#scripts/issue/issue-cite'
import type { JoshResult } from '#scripts/josh/josh-run'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { lane_process_table, type TableRead } from '#scripts/lane/lane-process-table'
import { lane_registry, type LaneInfo } from '#scripts/lane/lane-registry'
import { lane_snapshot_trace } from '#scripts/lane/lane-snapshot-trace'
import { lane_spent } from '#scripts/lane/lane-spent'
import { lane_state } from '#scripts/lane/lane-state'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_scope } from '#scripts/run/event/run-event-scope'
import { run_event_stream } from '#scripts/run/event/run-event-stream'
import { run_event_stream_emit } from '#scripts/run/event/run-event-stream-emit'
import { run_headless } from '#scripts/run/run-headless'
import { run_invocation } from '#scripts/run/run-invocation'
import { backlog_drive_restore } from './backlog-drive-restore'
import { backlog_next_shared } from './backlog-next-shared'
import { backlog_occupied } from './backlog-occupied'
import { backlog_offer_exclude } from './backlog-offer-exclude'
import { backlog_stalled } from './backlog-stalled'

// The ready line reports runnable work to the driving backlogrun parent on a watcher wake.

const NO_FREE = 0
const NONE = 0

interface ReadyReading {
	issues: ReadonlyArray<string>
	free_lanes: number
}

// How many open lanes hold a place under the limit, how many hold a port seat, and the ones with no
// lane state record.
interface LaneUse {
	occupied: number
	seated: number
	unknown: ReadonlyArray<string>
}

// The lanes that hold a place under the limit, read once for every count drawn from them.
interface LaneRoom {
	occupied: ReadonlyArray<LaneInfo>
	// The open lanes no child is working in, read from the same snapshot.
	idle: ReadonlyArray<string>
	// The open lanes with no lane state record, counted as holding a place until one is written.
	unknown: ReadonlyArray<string>
	use: LaneUse
}

interface LaneCount {
	limit: number
	free: number
}

interface ReadyPorts {
	free_lane_count: () => Promise<number>
	ready_issues: () => Promise<ReadonlyArray<string>>
}

// The lanes that hold a place under the limit (`backlog-occupied.ts`), the idle ones and the unknown
// ones. Paused is each lane's state record's answer; every lane's idle reading is drawn from one
// asynchronous process snapshot, so the count never blocks its caller's event loop
// (joshuafolkken/kit#4241, #4245); `run:board` passes the snapshot its redraw already read (#4246).
async function occupancy_of(
	open: ReadonlyArray<LaneInfo>,
	table: TableRead,
): Promise<Omit<LaneRoom, 'use'>> {
	const rows = await table()
	const issues = open.map((lane) => lane.issue)
	const trace = { process_trace: await lane_snapshot_trace.traces_of(issues, rows) }
	const records = await lane_state.read_states(issues)
	const is_merge_waiting = await lane_snapshot_trace.merge_waits_of(issues, rows)
	const occupied = backlog_occupied.occupied_lanes(
		open,
		(live) => lane_spent.idle_lanes(live, trace),
		records,
		is_merge_waiting,
	)
	const unknown = backlog_occupied.unknown_lanes(open, records)

	return { occupied, idle: lane_spent.idle_lanes(open, trace), unknown }
}

// Execution places and port ownership are independent; a saved tree alone occupies neither seat.
async function lane_room(
	lanes?: ReadonlyArray<LaneInfo>,
	table: TableRead = lane_process_table.read_table,
): Promise<LaneRoom> {
	const open = lanes ?? (await lane_registry.list_lanes())
	const occupancy = await occupancy_of(open, table)
	const seated =
		lane_registry.unreadable_lanes(open).length > 0
			? lane_capacity.seated_limit(Infinity)
			: lane_registry.used_seats(open).length

	const use = { occupied: occupancy.occupied.length, seated, unknown: occupancy.unknown }

	return { ...occupancy, use }
}

async function lane_use(lanes?: ReadonlyArray<LaneInfo>): Promise<LaneUse> {
	const room = await lane_room(lanes)

	return room.use
}

function free_of(limit: number, use: LaneUse): number {
	return lane_capacity.free_lanes(limit, use.occupied, use.seated)
}

// The limit and the free lanes in `room`, `undefined` where the limit could not be read: the count
// `lane:limit` prints, and the one `run:board` draws, so the two never answer apart.
async function count_in(room: LaneRoom): Promise<LaneCount | undefined> {
	const limit = await lane_capacity.lane_limit()

	if (limit.kind !== 'limit') return undefined

	return { limit: limit.limit, free: free_of(limit.limit, room.use) }
}

async function free_lanes_beside(lanes: ReadonlyArray<LaneInfo>): Promise<number | undefined> {
	const count = await count_in(await lane_room(lanes))

	return count?.free
}

async function free_under(limit: number): Promise<number> {
	return free_of(limit, await lane_use())
}

// Free lanes right now: the limit less the live lanes. An unreadable limit reads as no free lane — the
// safe direction, since both the stall and the ready line need a free lane and reporting one that is
// not there is the false positive neither may raise.
//
// **Occupancy is the local worktree count, not the dispatch budget's busy read.** `epic-lane-offer`
// measures occupancy with `epic_busy.occupied_lanes`, a network read of in-progress issue labels; this
// counts the worktrees that hold a place instead (`backlog-occupied.ts`), deliberately — it runs on the
// cheap-first path where the costly read (`backlog:next`) is gated behind a free lane, so a network
// read here would defeat that design. The two can diverge, but only toward over-counting live lanes →
// fewer free lanes, the safe direction.
async function free_lane_count(): Promise<number> {
	return (await free_lanes_beside(await lane_registry.list_lanes())) ?? NO_FREE
}

// **The drive's count throws on an unreadable limit**. The drive launches no
// more than this count, so the safe-direction zero above would leave it launching nothing and reporting
// nothing for good; a bad setting is the hard error `lane_capacity` says it is, ending the drive loudly.
async function drive_limit(): Promise<number> {
	const limit = await lane_capacity.lane_limit()

	if (limit.kind !== 'limit') throw new Error(limit.problem)

	return limit.limit
}

async function drive_free_lane_count(): Promise<number> {
	return await free_under(await drive_limit())
}

// Execution room alone; the drive also checks free port seats for fresh and resumed children.
async function drive_limit_room(): Promise<number> {
	const limit = await drive_limit()
	const use = await lane_use()

	return lane_capacity.limit_room(limit, use.occupied)
}

// **A `--only` run has no pool to drain**. `backlog:next` lists the opted-in
// pool, and a `--only` run's work is its named list — issues and epics that run in order through their
// own step, never through the pick-up ask — so a ready pool issue is neither a stall nor an ask it owes.
// Without a `--only` record the pool is the run's, whole.
function drains_pool(carry: RunCarry | undefined): boolean {
	return carry === undefined || !run_invocation.has_only(carry.invocation)
}

// The offer's own exclusion, read off this run's stream: a merged child `backlog:next` still reads OPEN,
// or one in flight, is no ready work (joshuafolkken/kit#4349). Scoped to this invocation, as the drive's
// list is: the stream is the repository's log, so an earlier run's merge or unsettled launch would
// otherwise hide a reopened issue for good.
async function stream_exclude(carry: RunCarry | undefined): Promise<ReadonlyArray<string>> {
	const target = await run_event_stream_emit.stream_target()

	if (target === undefined || carry === undefined) return []

	const scope = run_event_scope.scope_of({ kind: 'carried', carry })
	const events = run_event_scope.scoped_events(run_event_stream.read_events(target), scope) ?? []

	return backlog_drive_restore.offer_exclude(events)
}

// The `backlog:next` read, or `undefined` for a `--only` run, which answers none before paying for the
// network read. A bounded read keeps stderr piped: the arrival probe reads once
// a minute, and a forwarded refusal would fill the watcher's output.
async function read_backlog_next(timeout_ms?: number): Promise<JoshResult | undefined> {
	const carry = await run_headless.current_carry()

	if (!drains_pool(carry)) return undefined

	const argv = ['backlog:next', ...backlog_offer_exclude.exclude_argv(await stream_exclude(carry))]

	return await backlog_next_shared.read(argv, timeout_ms === undefined, timeout_ms)
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

// `undefined` unless there is both runnable work and a lane for it — the only state worth a line. Each
// issue is a number-link against `slug`: the parent copies this line into its
// report, so a bare `#N` here is the citation the Stop guard sends back.
function ready_line(reading: ReadyReading, slug: string | undefined): string | undefined {
	if (reading.issues.length === NONE || reading.free_lanes <= NO_FREE) return undefined

	const cite = issue_cite.citer(slug, new Map())
	const issues = reading.issues.map((issue) => cite(issue)).join(' ')

	return `ready ${issues} · free lanes ${String(reading.free_lanes)}`
}

type RepoRead = () => Promise<string | undefined>

// The watcher's line on exit, for the driving parent alone — a `fullrun` watcher has no pool to pick
// from. Best-effort: a reading that fails prints nothing rather than failing the watcher whose exit is
// the wake.
async function parent_ready_line(
	ports: ReadyPorts,
	is_parent: () => Promise<boolean>,
	read_repo: RepoRead,
): Promise<string | undefined> {
	if (!(await is_parent())) return undefined

	const reading = await read_ready(ports)

	return reading.issues.length === NONE ? undefined : ready_line(reading, await read_repo())
}

function print_line(line: string | undefined): void {
	if (line !== undefined) console.info(line)
}

async function print_ready_line(
	ports: ReadyPorts = DEFAULT_PORTS,
	is_parent: () => Promise<boolean> = run_headless.is_backlog_parent,
	read_repo: RepoRead = git_gh_command.repo_get_name_with_owner,
): Promise<void> {
	try {
		print_line(await parent_ready_line(ports, is_parent, read_repo))
	} catch {
		// A pick-up line is a hint; the wake it rides must still be delivered.
	}
}

// The line `epic --add` prints once a child entered an epic while a `backlogrun` parent drives this
// checkout: a filing made mid-run joins the pool the moment it is placed, so the parent asks now rather
// than on the next wake. The recommendation commands (`issue:scout`,
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
	free_lanes_beside,
	count_in,
	lane_room,
	lane_use,
	drive_free_lane_count,
	drive_limit_room,
	drains_pool,
	print_ready_line,
	read_ready,
	ready_issues,
	ready_line,
}

export { backlog_ready }
export type { LaneCount, LaneRoom, LaneUse, ReadyPorts, ReadyReading }

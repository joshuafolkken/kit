import { josh_command } from '#scripts/josh/josh-run'
import { lane_capacity } from '#scripts/lane/lane-capacity'
import { lane_registry } from '#scripts/lane/lane-registry'
import { run_event_stream, type RunEvent } from '#scripts/run/run-event-stream'
import { run_headless } from '#scripts/run/run-headless'
import { backlog_stalled } from './backlog-stalled'

// The pick-up signal a `backlogrun` parent is woken with (joshuafolkken/kit#2452). A parent woken five
// times by the progress watcher relayed each line and restarted the watcher without once asking for the
// next issue, while a runnable one sat in `backlog:plan` and lanes were free: the ask on each wake was
// prose alone (`backlogrun-progress.md` → "The wake is used for both halves at once"), and neither the
// watcher's output nor the recorded `stall` event reached the parent as something to act on.
//
// **Two halves, one reading.** The watcher prints `ready_line` on every exit so the woken parent sees the
// runnable work; the `Stop` hook reads `owes_offer` over the turn so a parent that saw it — or that a
// `stall` event names — and still dispatched nothing is sent back to ask.

const NO_FREE = 0
const NONE = 0

// The line a woken parent reads. Kept distinct enough that the transcript scan below matches it and no
// prose that merely mentions it: `ready #2445 #2446 · free lanes 4`.
const READY_LINE_PATTERN = /ready(?: #\d+)+ · free lanes [1-9]\d*/u

// The two calls that answer the pick-up — a dispatch, or the ask whose `watch` / `wait` is itself an
// answer — as they appear in a transcript's tool-call input, aliases included. Matching the JSON
// `command` field keeps the refusal's own prose, which names both, from satisfying it.
const DISPATCH_CALL_PATTERN =
	/"command":"[^"]*pnpm (?:-s )?josh (?:lane:launch|lnla|backlog:offer|blo)\b/u

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

// The runnable issues for this checkout, read the way a loop reads them: `backlog:next`'s numeric lines.
async function ready_issues(): Promise<ReadonlyArray<string>> {
	const result = await josh_command.josh_run(['backlog:next'], true)

	return backlog_stalled.ready_tokens(result.out)
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

function has_ready_line(text: string): boolean {
	return READY_LINE_PATTERN.test(text)
}

function has_dispatch_call(text: string): boolean {
	return DISPATCH_CALL_PATTERN.test(text)
}

// A `stall` that is still where the run stands: the detector saw ready work and a free lane, and no step
// has been recorded since. Any later position — a launch, a merge, a park, the drain — answers it, so a
// stall whose ready work went away without a launch stops sending the parent back.
function is_stall_pending(events: ReadonlyArray<RunEvent>): boolean {
	const last = events.findLast((event) => !run_event_stream.TRACE_KINDS.has(event.kind))

	return last?.kind === run_event_stream.EVENT_KIND.STALL
}

/**
 * Whether a `backlogrun` parent's turn owes the pick-up ask: it holds a signal — a ready line on the
 * turn, or a pending `stall` — and ran neither a dispatch nor the ask. An ask that answered `watch` or
 * `wait` has been made, so that turn owes nothing.
 */
function owes_offer(turn: string, events: ReadonlyArray<RunEvent>): boolean {
	if (has_dispatch_call(turn)) return false

	return has_ready_line(turn) || is_stall_pending(events)
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
	print_offer_hint,
	free_lane_count,
	has_dispatch_call,
	has_ready_line,
	is_stall_pending,
	owes_offer,
	print_ready_line,
	read_ready,
	ready_issues,
	ready_line,
}

export { backlog_ready }
export type { ReadyPorts, ReadyReading }

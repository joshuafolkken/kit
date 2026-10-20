import { backlog_drive_named } from '#scripts/backlog/backlog-drive-named'
import { backlog_overlap } from '#scripts/backlog/backlog-overlap'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_solo, type SoloQueue } from '#scripts/epic/epic-solo'
import { epic_triage } from '#scripts/epic/epic-triage'
import { issue_not_before } from '#scripts/issue/issue-not-before'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type Overlay, type ReasonOf, type RowReason } from './run-board-layout'
import { run_board_machine, type MachineGauges } from './run-board-machine'
import { run_board_planning, type Planning } from './run-board-planning'
import { run_board_setup } from './run-board-setup'
import type { ItemStatus } from './run-board-status'

// Why each waiting row waits — pure, so the reasons are tested apart from the screen. Each is one
// `RowReason` its row only draws (joshuafolkken/kit#4288): an icon, the condition column's value and
// what follows the title. A row whose lane is being opened leads with the stage that lane is at; any
// other with what `backlog:next` would answer for it, read off the same rules — after the row a
// planning run is for, which says so (`run-board-planning.ts`): the driver's declared order for a named
// run's issue, `epic_triage` for an untriaged issue, `epic_solo` for a `run:solo` issue and the rows
// behind it, `backlog_overlap` for a declared path a running issue holds, the lane limit for a full
// pool. A start time the body declares and the clock has not
// reached (`issue-not-before.ts`) comes before the pool's reasons, since the pickup never offers the
// row until then; it reads in the local time every other time on the board does (#4017). A blocker
// leads its row with `🔗`; a row that nobody has judged leads with ❓ even where it is blocked, since
// judging it is what a person can do meanwhile.

const { LANE_STAGE } = run_event_setup
const { HEADER_ICONS, STAGE_ICONS, WAIT_ICONS } = run_board_labels
const NO_FREE_LANES = 0
const FIRST_ONLY = 1

// The stages a lane's launch passes, each leading its row with its own icon.
const LANE_STAGES: ReadonlyArray<string> = [
	LANE_STAGE.OPENING,
	LANE_STAGE.INSTALLING,
	LANE_STAGE.DISPATCHING,
]

// What the reasons are read from, beside the plan and the statuses a layout is drawn from.
interface ReasonRead extends Overlay {
	events: ReadonlyArray<RunEvent>
	// How many more lanes the limit allows; `undefined` where it could not be read.
	free_lanes: number | undefined
	// How many lanes hold a place under the limit, counted after `🧵`.
	occupied_count?: number | undefined
	// The limit those lanes fill; `undefined` where it could not be read.
	lane_limit?: number | undefined
	// The driver holds its offered issue for memory (`backlog-drive-memory.ts`).
	is_memory_held?: boolean | undefined
	// The machine's latest gauges, the figures a memory hold names.
	gauges?: MachineGauges | undefined
	// The run's record, whose declared order holds the issues declared after one in flight.
	carry?: RunCarry | undefined
	// A stopped run opens no lane, so a stage its stream ends on is not one any lane is at.
	is_stopped: boolean
}

// What every row of one layout is weighed against, read once.
interface Pool {
	// The untriaged issue nothing blocks that withholds every candidate (`epic-triage.ts`), if any.
	held_by: number | undefined
	running: ReadonlyArray<number>
	// The row the run's planning is for, while the run plans (`run-board-planning.ts`).
	planning: Planning | undefined
	// The first `run:solo` candidate and the candidates behind it (`epic-solo.ts`), if any.
	solo: SoloQueue | undefined
}

function stage_icon(text: string): string | undefined {
	const stage = LANE_STAGES.find((name) => text.startsWith(name))

	return stage === undefined ? undefined : STAGE_ICONS[stage]
}

function stage_of(child: EpicChild, read: ReasonRead): RowReason | undefined {
	const stage = read.is_stopped ? undefined : run_board_setup.lane_stage(read.events, child.number)
	const icon = stage === undefined ? undefined : stage_icon(stage.text)

	if (stage === undefined || icon === undefined) return undefined

	return { icon, since_ms: stage.at_ms }
}

function is_untriaged_candidate(child: EpicChild, read: ReasonRead): boolean {
	return !epic_triage.is_triaged(child) && !run_board_layout.is_blocked(child, read)
}

// A child whose lane stands with no one in it still holds the paths it declared, as its open lane does.
function holds_paths(status: ItemStatus): boolean {
	return status.state === 'running' || status.lane !== undefined
}

function running_of(read: ReasonRead): Array<number> {
	return [...read.statuses].filter(([, status]) => holds_paths(status)).map(([issue]) => issue)
}

// A waiting row the pool could offer: judged, due, and with no blocker standing — a start time not yet
// reached keeps a row out of `backlog:next`'s candidates, so it holds nothing behind it.
function is_candidate(child: EpicChild, read: ReasonRead): boolean {
	return (
		epic_triage.is_triaged(child) &&
		issue_not_before.is_due(child.body) &&
		!run_board_layout.is_blocked(child, read)
	)
}

function pool_of(read: ReasonRead): Pool {
	const waiting = run_board_layout.waiting_children(read)
	const running = running_of(read)
	const candidates = waiting.filter((child) => is_candidate(child, read))

	return {
		held_by: waiting.find((child) => is_untriaged_candidate(child, read))?.number,
		running,
		planning: run_board_planning.planning_of(read, running),
		solo: epic_solo.queue_of(candidates),
	}
}

function planned_of(child: EpicChild, pool: Pool): RowReason | undefined {
	return pool.planning?.issue === child.number ? pool.planning.reason : undefined
}

// `📂 4238 … scripts/gate/machine-capacity.ts`: the running issue holding a path this row declares,
// and the path after the title.
function overlap_of(child: EpicChild, read: ReasonRead, pool: Pool): RowReason | undefined {
	const { declared = new Map(), context } = read.plan
	const holding = { holders: pool.running, repo: context.repo }
	const clash = backlog_overlap.running_clash(child, declared, holding)

	if (clash === undefined) return undefined

	return { icon: WAIT_ICONS.path, issues: [String(clash.holder)], tail: clash.path }
}

// `🧵 4/4`: how many lanes hold a place against the limit the row starts after a free one of. Every
// waiting row repeated the same breakdown of them, so the row counts them and names none (#4111).
function no_lane_of(read: ReasonRead): RowReason {
	const { occupied_count = 0, lane_limit } = read

	if (lane_limit === undefined) return { icon: WAIT_ICONS.lane }

	return { icon: WAIT_ICONS.lane, value: `${String(occupied_count)}/${String(lane_limit)}` }
}

// `🧠 88% … 💾 12M/s`: run:board's own latest 🧠 / 💾, not the driver's reading, so a hold the kernel's
// verdict alone raised may show both green. Each is drawn only where it was read (#4084); the 💾 follows
// the title, so the row draws 🧠 once.
function no_memory_of(gauges: MachineGauges | undefined): RowReason {
	const { percent_text, rate_text } = run_board_machine
	const memory = gauges?.memory_percent
	const swap = gauges?.swap_mb_per_s

	return {
		icon: WAIT_ICONS.memory,
		value: memory === undefined ? undefined : percent_text(memory).trim(),
		tail: swap === undefined ? undefined : `${HEADER_ICONS.swap} ${rate_text(swap).trim()}`,
	}
}

// The machine's room: no lane left under the limit, else no memory for one more.
function room_wait(read: ReasonRead): RowReason | undefined {
	if (read.free_lanes === NO_FREE_LANES) return no_lane_of(read)

	return read.is_memory_held === true ? no_memory_of(read.gauges) : undefined
}

// `📋 4198`: the declared issue a named run starts this one after — the driver's own reading
// (`backlog-drive-named.ts`), asked before it offers anything.
function named_of(child: EpicChild, read: ReasonRead, pool: Pool): RowReason | undefined {
	if (read.carry === undefined) return undefined
	const in_flight = pool.running.map(String)
	const holder = backlog_drive_named.held_after(read.carry, in_flight, child.number)

	return holder === undefined ? undefined : { icon: WAIT_ICONS.named, issues: [String(holder)] }
}

// `✋ 4301`: the untriaged issue the pool is held for a judgment of.
function held_of(pool: Pool): RowReason | undefined {
	if (pool.held_by === undefined) return undefined

	return { icon: WAIT_ICONS.held, issues: [String(pool.held_by)] }
}

// `🧍 4288+1 … 4268`: a `run:solo` issue starts only into an idle repository, so it names the running
// lanes it waits for — the first in the condition column, the rest after the title.
function alone_of(running: ReadonlyArray<number>): RowReason | undefined {
	return running.length === 0 ? undefined : { icon: WAIT_ICONS.solo, issues: running.map(String) }
}

// `🙅 4287`: nothing ranked behind a waiting `run:solo` issue is offered past it.
function solo_of(child: EpicChild, pool: Pool): RowReason | undefined {
	const { solo } = pool

	if (solo === undefined) return undefined
	if (solo.solo.number === child.number) return alone_of(pool.running)
	const is_behind = solo.behind.some((item) => item.number === child.number)

	return is_behind ? { icon: WAIT_ICONS.solo_ahead, issues: [String(solo.solo.number)] } : undefined
}

// A candidate nothing blocks, in the order the driver answers: the declared order, then what
// `backlog:next` answers — the pool held for a judgment, then a `run:solo` issue's wait, then a path a
// running issue declares, then a pool with no lane left, then a machine with no memory.
function offer_wait(child: EpicChild, read: ReasonRead, pool: Pool): RowReason | undefined {
	return (
		named_of(child, read, pool) ??
		held_of(pool) ??
		solo_of(child, pool) ??
		overlap_of(child, read, pool) ??
		room_wait(read)
	)
}

// `📅 10-20 16:30`: the start time the body declares and the clock has not reached, in the board's
// local time.
function not_before_of(child: EpicChild): RowReason | undefined {
	const ms = issue_not_before.waiting_ms(child.body)

	if (ms === undefined) return undefined

	return {
		icon: WAIT_ICONS.not_before,
		value: run_board_labels.day_minute_of(ms),
		not_before_ms: ms,
	}
}

// `❓ 4183`: an issue nobody has judged, naming its first standing blocker where it has one.
function untriaged_of(waits: ReadonlyArray<string>): RowReason {
	return { icon: WAIT_ICONS.untriaged, issues: waits.slice(0, FIRST_ONLY) }
}

function wait_of(
	child: EpicChild,
	waits: ReadonlyArray<string>,
	read: ReasonRead,
	pool: Pool,
): RowReason | undefined {
	if (!epic_triage.is_triaged(child)) return untriaged_of(waits)
	if (waits.length > 0) return { icon: WAIT_ICONS.blocker, issues: waits }

	return not_before_of(child) ?? offer_wait(child, read, pool)
}

// What each waiting row of one layout says, the pool-wide facts read once for all of them.
function reader(read: ReasonRead): ReasonOf {
	const pool = pool_of(read)

	return function reason_of(child, waits) {
		return stage_of(child, read) ?? planned_of(child, pool) ?? wait_of(child, waits, read, pool)
	}
}

const run_board_reason = { reader }

export { run_board_reason }
export type { ReasonRead }

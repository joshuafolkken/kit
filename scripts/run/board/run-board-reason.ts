import { backlog_drive_named } from '#scripts/backlog/backlog-drive-named'
import { backlog_overlap } from '#scripts/backlog/backlog-overlap'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_solo, type Labelled, type SoloQueue } from '#scripts/epic/epic-solo'
import { epic_triage } from '#scripts/epic/epic-triage'
import { has_label_name, has_parked_label, IN_PROGRESS_LABEL } from '#scripts/issue/issue-labels'
import { issue_not_before } from '#scripts/issue/issue-not-before'
import { issue_sample_gate } from '#scripts/issue/issue-sample-gate'
import { lane_state } from '#scripts/lane/lane-state'
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
// run's issue, `epic_triage` for an untriaged issue, `epic_solo` for a running `run:solo` issue, a
// waiting one and the rows behind it, `backlog_overlap` for a declared path a running issue holds,
// the lane limit for a full pool. A start time the body declares and the clock has not reached
// (`issue-not-before.ts`) comes before the pool's reasons, since the pickup never offers the row
// until then; it reads in the local time every other time on the board does (#4017). A blocker
// leads its row with `🔗`; a row that nobody has judged leads with ❓ even where it is blocked, since
// judging it is what a person can do meanwhile.

const { LANE_STAGE } = run_event_setup
const { HEADER_ICONS, STAGE_ICONS, STATE_ICONS, WAIT_ICONS } = run_board_labels
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
	// The reset a Claude usage limit holds launches until (`run-merge-usage-limit.ts`), if one does.
	usage_reset_ms?: number | undefined
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
	// The issues the classifier withholds for a person (`epic-outside-blocker.ts`'s `human`).
	withheld: ReadonlySet<number>
	// The row the run's planning is for, while the run plans (`run-board-planning.ts`).
	planning: Planning | undefined
	// The first `run:solo` candidate and the candidates behind it (`epic-solo.ts`), if any.
	solo: SoloQueue | undefined
	// The running `run:solo` issue that lets nothing new start (`epic_solo.holder_of`), if any.
	solo_holder: number | undefined
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

// Every open issue holding a lane as `backlog:next` reads it (`epic-busy.ts`): `in-progress` and no
// park label — a paused lane, or one another run or a person works, holds as this run's lanes do.
function running_labelled(read: ReasonRead): Array<Labelled> {
	return [...read.plan.labels]
		.filter(([, labels]) => has_label_name(labels, IN_PROGRESS_LABEL) && !has_parked_label(labels))
		.map(([number, labels]) => ({ number, labels }))
}

function pool_of(read: ReasonRead): Pool {
	const waiting = run_board_layout.waiting_children(read)
	const running = running_of(read)
	const candidates = waiting.filter((child) => is_candidate(child, read))

	return {
		held_by: waiting.find((child) => is_untriaged_candidate(child, read))?.number,
		running,
		withheld: read.plan.withheld ?? new Set(),
		planning: run_board_planning.planning_of(read, running),
		solo: epic_solo.queue_of(candidates),
		solo_holder: epic_solo.holder_of(running_labelled(read)),
	}
}

function planned_of(child: EpicChild, pool: Pool): RowReason | undefined {
	return pool.planning?.issue === child.number ? pool.planning.reason : undefined
}

// ` — paused since 01:28 by lane:pause` for a holder whose lane is paused (joshuafolkken/kit#4270):
// only a paused lane's status carries who paused it, and its end is when.
function paused_tail(status: ItemStatus | undefined): string {
	const { ended_ms, paused_by } = status ?? {}

	if (paused_by === undefined || ended_ms === undefined) return ''

	return ` — ${lane_state.paused_text(ended_ms, paused_by)}`
}

// `📂 4238 … scripts/gate/machine-capacity.ts`: the running issue holding a path this row declares,
// and the path after the title — with when and by what the holder was paused, where it is.
function overlap_of(child: EpicChild, read: ReasonRead, pool: Pool): RowReason | undefined {
	const { declared = new Map(), context } = read.plan
	const holding = { holders: pool.running, repo: context.repo }
	const clash = backlog_overlap.running_clash(child, declared, holding)

	if (clash === undefined) return undefined

	const tail = `${clash.path}${paused_tail(read.statuses.get(clash.holder))}`

	return { icon: WAIT_ICONS.path, issues: [String(clash.holder)], tail }
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

// `🪫 10-25 16:30`: the reset a usage limit holds every launch until, in the board's local time.
function usage_limit_of(reset_ms: number): RowReason {
	return { icon: WAIT_ICONS.usage_limit, value: run_board_labels.day_minute_of(reset_ms) }
}

// The machine's room: no lane left under the limit, else a usage limit not yet reset, else no memory
// for one more — the order `backlog:drive` asks them in.
function room_wait(read: ReasonRead): RowReason | undefined {
	if (read.free_lanes === NO_FREE_LANES) return no_lane_of(read)
	if (read.usage_reset_ms !== undefined) return usage_limit_of(read.usage_reset_ms)

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

// `🔒 4374`: the running `run:solo` issue nothing new starts beside until it merges or is parked.
function held_solo_of(pool: Pool): RowReason | undefined {
	if (pool.solo_holder === undefined) return undefined

	return { icon: WAIT_ICONS.solo_running, issues: [String(pool.solo_holder)] }
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

// The `run:solo` gate as `epic_solo.select` reads it: a running `run:solo` issue first, then a waiting
// one's wait.
function solo_wait(child: EpicChild, pool: Pool): RowReason | undefined {
	return held_solo_of(pool) ?? solo_of(child, pool)
}

// A candidate nothing blocks, in the order the driver answers: the declared order, then what
// `backlog:next` answers — the pool held for a judgment, then a running `run:solo` issue, then a
// waiting `run:solo` issue's wait, then a path a running issue declares, then a pool with no lane
// left, then a usage limit not yet reset, then a machine with no memory.
function offer_wait(child: EpicChild, read: ReasonRead, pool: Pool): RowReason | undefined {
	return (
		named_of(child, read, pool) ??
		held_of(pool) ??
		solo_wait(child, pool) ??
		overlap_of(child, read, pool) ??
		room_wait(read)
	)
}

// `📅 3/10`: the merges the ledger recorded after the declared pull request merged, of those the body
// waits on; `📅 4313` while that pull request has not merged or its merge is unread.
function sample_wait_of(child: EpicChild): RowReason | undefined {
	const wait = issue_sample_gate.wait_of(child.body)

	if (wait === undefined) return undefined
	if (wait.kind !== 'short') return { icon: WAIT_ICONS.not_before, issues: [String(wait.pr)] }

	return { icon: WAIT_ICONS.not_before, value: `${String(wait.counted)}/${String(wait.needed)}` }
}

// `📅 10-20 16:30`: the start time the body declares and the clock has not reached, in the board's
// local time.
function not_before_of(child: EpicChild): RowReason | undefined {
	const ms = issue_not_before.waiting_ms(child.body)

	if (ms === undefined) return sample_wait_of(child)

	return {
		icon: WAIT_ICONS.not_before,
		value: run_board_labels.day_minute_of(ms),
		not_before_ms: ms,
	}
}

// `🔗 4183` for a blocker the run finishes, `🙋 4183` where the classifier withholds the row for a
// person: the run will not finish a blocker it waits on (joshuafolkken/kit#4292).
function blocker_icon(child: EpicChild, pool: Pool): string {
	return pool.withheld.has(child.number) ? STATE_ICONS.human : WAIT_ICONS.blocker
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
	if (waits.length > 0) return { icon: blocker_icon(child, pool), issues: waits }

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

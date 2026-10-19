import { backlog_drive_named } from '#scripts/backlog/backlog-drive-named'
import { backlog_overlap } from '#scripts/backlog/backlog-overlap'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_triage } from '#scripts/epic/epic-triage'
import { issue_not_before } from '#scripts/issue/issue-not-before'
import type { RunCarry } from '#scripts/run/carry/run-carry'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type Overlay, type ReasonOf, type RowReason } from './run-board-layout'
import { run_board_machine, type MachineGauges } from './run-board-machine'
import { run_board_setup } from './run-board-setup'
import type { ItemStatus } from './run-board-status'

// Why each waiting row waits — pure, so the words are tested apart from the screen. A row whose lane is
// being opened says the stage that lane is at; any other says what `backlog:next` would answer for it,
// read off the same rules: the driver's declared order for a named run's issue, `epic_triage` for an untriaged issue, `backlog_overlap` for a declared path a
// running issue holds, the lane limit for a full pool. A start time the body declares and the clock has
// not reached (`issue-not-before.ts`) comes before the pool's reasons, since the pickup never offers
// the row until then; it reads in the local time every other time on the board does (#4017). A blocker stays the row's `🔗`; only a row that nobody has judged says so beside
// it, since judging it is what a person can do meanwhile.
// Every word is English whatever the session language, as every other word on the board is.

const { LANE_STAGE } = run_event_setup
const { HEADER_ICONS } = run_board_labels
const NO_FREE_LANES = 0

const WORDS = {
	untriaged: 'untriaged',
	held: 'held by triage',
	no_lane: 'next free lane',
	no_memory: 'no memory headroom',
	after: 'after',
	named: 'named order',
} as const

const FIGURE_SEPARATOR = ' · '

// A lane's stage as its row says it: the event's own words, cut to what fits beside a title.
const STAGE_WORDS: ReadonlyArray<readonly [stage: string, word: string]> = [
	[LANE_STAGE.OPENING, 'opening lane'],
	[LANE_STAGE.INSTALLING, 'installing'],
	[LANE_STAGE.DISPATCHING, 'dispatching'],
]

// What the reasons are read from, beside the plan and the statuses a layout is drawn from.
interface ReasonRead extends Overlay {
	events: ReadonlyArray<RunEvent>
	// How many more lanes the limit allows; `undefined` where it could not be read.
	free_lanes: number | undefined
	// How many lanes hold a place under the limit, counted after `next free lane`.
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
	// An untriaged issue nothing blocks withholds every candidate (`epic-triage.ts`).
	is_held: boolean
	running: ReadonlyArray<number>
}

function stage_word(text: string): string | undefined {
	return STAGE_WORDS.find(([stage]) => text.startsWith(stage))?.[1]
}

function stage_of(child: EpicChild, read: ReasonRead): RowReason | undefined {
	const stage = read.is_stopped ? undefined : run_board_setup.lane_stage(read.events, child.number)
	const text = stage === undefined ? undefined : stage_word(stage.text)

	if (stage === undefined || text === undefined) return undefined

	return { text, since_ms: stage.at_ms }
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

function pool_of(read: ReasonRead): Pool {
	const waiting = run_board_layout.waiting_children(read)

	return {
		is_held: waiting.some((child) => is_untriaged_candidate(child, read)),
		running: running_of(read),
	}
}

function overlap_of(child: EpicChild, read: ReasonRead, pool: Pool): string | undefined {
	const { declared = new Map(), context } = read.plan
	const holding = { holders: pool.running, repo: context.repo }
	const clash = backlog_overlap.running_clash(child, declared, holding)

	return clash === undefined
		? undefined
		: `${WORDS.after} ${String(clash.holder)}${FIGURE_SEPARATOR}${clash.path}`
}

// `next free lane (4/4)`: what the row starts after, and how many lanes hold a place against the
// limit. Every waiting row repeated the same breakdown of them, so the row counts them and names none
// (#4111); it says what it starts after rather than what it lacks (joshuafolkken/kit#4137).
function no_lane_of(read: ReasonRead): string {
	const { occupied_count = 0, lane_limit } = read

	if (lane_limit === undefined) return WORDS.no_lane

	return `${WORDS.no_lane} (${String(occupied_count)}/${String(lane_limit)})`
}

// `no memory headroom — 🧠 88% · 💾 12M/s`: run:board's own latest 🧠 / 💾, not the driver's reading,
// so a hold the kernel's verdict alone raised may show both green. Each is drawn only where it was
// read (#4084).
function figure_of(
	icon: string,
	value: number | undefined,
	format: (value: number) => string,
): string | undefined {
	return value === undefined ? undefined : `${icon} ${format(value).trim()}`
}

function no_memory_of(gauges: MachineGauges | undefined): string {
	const { percent_text, rate_text } = run_board_machine
	const figures = [
		figure_of(HEADER_ICONS.memory, gauges?.memory_percent, percent_text),
		figure_of(HEADER_ICONS.swap, gauges?.swap_mb_per_s, rate_text),
	].filter((figure) => figure !== undefined)

	if (figures.length === 0) return WORDS.no_memory

	return `${WORDS.no_memory} — ${figures.join(FIGURE_SEPARATOR)}`
}

// The machine's room: no lane left under the limit, else no memory for one more.
function room_wait(read: ReasonRead): string | undefined {
	if (read.free_lanes === NO_FREE_LANES) return no_lane_of(read)

	return read.is_memory_held === true ? no_memory_of(read.gauges) : undefined
}

// `after 4198 · named order`: the declared issue a named run starts this one after — the driver's own
// reading (`backlog-drive-named.ts`), asked before it offers anything.
function named_of(child: EpicChild, read: ReasonRead, pool: Pool): string | undefined {
	if (read.carry === undefined) return undefined
	const in_flight = pool.running.map(String)
	const holder = backlog_drive_named.held_after(read.carry, in_flight, child.number)

	return holder === undefined
		? undefined
		: `${WORDS.after} ${String(holder)}${FIGURE_SEPARATOR}${WORDS.named}`
}

// A candidate nothing blocks, in the order the driver answers: the declared order, then what
// `backlog:next` answers — the pool held for a judgment, then a path a running issue declares, then a
// pool with no lane left, then a machine with no memory.
function offer_wait(child: EpicChild, read: ReasonRead, pool: Pool): string | undefined {
	const named = named_of(child, read, pool)

	if (named !== undefined) return named
	if (pool.is_held) return WORDS.held

	return overlap_of(child, read, pool) ?? room_wait(read)
}

// The start time the body declares and the clock has not reached, in the board's local time.
function not_before_of(child: EpicChild): RowReason | undefined {
	const ms = issue_not_before.waiting_ms(child.body)

	if (ms === undefined) return undefined

	return {
		text: `${run_board_labels.WORDS.not_before} ${run_board_labels.date_minute_of(ms)}`,
		not_before_ms: ms,
	}
}

function wait_of(child: EpicChild, read: ReasonRead, pool: Pool): RowReason | undefined {
	if (!epic_triage.is_triaged(child)) return { text: WORDS.untriaged }
	if (run_board_layout.is_blocked(child, read)) return undefined

	const dated = not_before_of(child)

	if (dated !== undefined) return dated

	const text = offer_wait(child, read, pool)

	return text === undefined ? undefined : { text }
}

// What each waiting row of one layout says, the pool-wide facts read once for all of them.
function reader(read: ReasonRead): ReasonOf {
	const pool = pool_of(read)

	return function reason_of(child: EpicChild): RowReason | undefined {
		return stage_of(child, read) ?? wait_of(child, read, pool)
	}
}

const run_board_reason = { reader }

export { run_board_reason }
export type { ReasonRead }

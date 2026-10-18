import { backlog_overlap } from '#scripts/backlog/backlog-overlap'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_triage } from '#scripts/epic/epic-triage'
import { issue_not_before } from '#scripts/issue/issue-not-before'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type Overlay, type ReasonOf, type RowReason } from './run-board-layout'
import { run_board_machine, type MachineGauges } from './run-board-machine'
import { run_board_setup } from './run-board-setup'
import type { ItemStatus } from './run-board-status'

// Why each waiting row waits — pure, so the words are tested apart from the screen. A row whose lane is
// being opened says the stage that lane is at; any other says what `backlog:next` would answer for it,
// read off the same rules: `epic_triage` for an untriaged issue, `backlog_overlap` for a declared path a
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
	no_lane: 'no free lane',
	no_memory: 'no memory headroom',
	overlaps: 'overlaps',
} as const

type LaneState = 'running' | 'parked' | 'idle'

const LANE_STATES: ReadonlyArray<LaneState> = ['running', 'parked', 'idle']
const LANE_SEPARATOR = ' · '

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
	// The issues whose lanes fill the limit, named after `no free lane` so a lane an earlier run left
	// behind shows on the row it holds back.
	occupied_lanes?: ReadonlyArray<string> | undefined
	// The limit those lanes fill; `undefined` where it could not be read.
	lane_limit?: number | undefined
	// The open lanes no child is working in (`lane-spent.ts`).
	idle_lanes?: ReadonlyArray<string> | undefined
	// The driver holds its offered issue for memory (`backlog-drive-memory.ts`).
	is_memory_held?: boolean | undefined
	// The machine's latest gauges, the figures a memory hold names.
	gauges?: MachineGauges | undefined
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
		: `${WORDS.overlaps} ${String(clash.holder)} (${clash.path})`
}

// What an occupying lane is doing: a child works in it, its child parked, or it stands with no child.
function lane_state(issue: string, read: ReasonRead): LaneState {
	if (!(read.idle_lanes ?? []).includes(issue)) return 'running'

	return read.statuses.get(Number(issue))?.state === 'parked' ? 'parked' : 'idle'
}

// The occupying lanes grouped by state, `4023 running · 3988 parked · 4002 4005 idle`.
function lanes_by_state(occupied: ReadonlyArray<string>, read: ReasonRead): string {
	const groups = LANE_STATES.map(function group_of(state: LaneState): string {
		const issues = occupied.filter((issue) => lane_state(issue, read) === state)

		return issues.length === 0 ? '' : `${issues.join(' ')} ${state}`
	})

	return groups.filter((group) => group !== '').join(LANE_SEPARATOR)
}

// `no free lane 4/4 — …`: how many lanes hold a place against the limit, and what each is doing (#4028).
function no_lane_of(read: ReasonRead): string {
	const { occupied_lanes: occupied = [], lane_limit } = read
	const count = lane_limit === undefined ? '' : ` ${String(occupied.length)}/${String(lane_limit)}`

	if (occupied.length === 0) return `${WORDS.no_lane}${count}`

	return `${WORDS.no_lane}${count} — ${lanes_by_state(occupied, read)}`
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

	return `${WORDS.no_memory} — ${figures.join(LANE_SEPARATOR)}`
}

// The machine's room: no lane left under the limit, else no memory for one more.
function room_wait(read: ReasonRead): string | undefined {
	if (read.free_lanes === NO_FREE_LANES) return no_lane_of(read)

	return read.is_memory_held === true ? no_memory_of(read.gauges) : undefined
}

// A candidate nothing blocks, in the order `backlog:next` answers: the pool held for a judgment, then
// a path a running issue declares, then a pool with no lane left, then a machine with no memory.
function offer_wait(child: EpicChild, read: ReasonRead, pool: Pool): string | undefined {
	if (pool.is_held) return WORDS.held

	return overlap_of(child, read, pool) ?? room_wait(read)
}

// The start time the body declares and the clock has not reached, in the board's local time.
function not_before_of(child: EpicChild): RowReason | undefined {
	const ms = issue_not_before.waiting_ms(child.body)

	if (ms === undefined) return undefined

	return {
		text: `${run_board_labels.WORDS.not_before} ${run_board_labels.date_minute_of(ms)}`,
		is_not_before: true,
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

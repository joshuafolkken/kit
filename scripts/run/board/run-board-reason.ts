import { backlog_overlap } from '#scripts/backlog/backlog-overlap'
import type { EpicChild } from '#scripts/epic/epic-graph'
import { epic_triage } from '#scripts/epic/epic-triage'
import { run_event_setup } from '#scripts/run/event/run-event-setup'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_board_layout, type Overlay, type ReasonOf, type RowReason } from './run-board-layout'
import { run_board_setup } from './run-board-setup'

// Why each waiting row waits — pure, so the words are tested apart from the screen. A row whose lane is
// being opened says the stage that lane is at; any other says what `backlog:next` would answer for it,
// read off the same rules: `epic_triage` for an untriaged issue, `backlog_overlap` for a declared path a
// running issue holds, the lane limit for a full pool. A blocker stays the row's `🔗`; only a row that
// nobody has judged says so beside it, since judging it is what a person can do meanwhile.
// Every word is English whatever the session language, as every other word on the board is.

const { LANE_STAGE } = run_event_setup
const NO_FREE_LANES = 0

const WORDS = {
	untriaged: 'untriaged',
	held: 'held by triage',
	no_lane: 'no free lane',
	overlaps: 'overlaps',
} as const

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

function running_of(read: ReasonRead): Array<number> {
	return [...read.statuses]
		.filter(([, status]) => status.state === 'running')
		.map(([issue]) => issue)
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

// A candidate nothing blocks, in the order `backlog:next` answers: the pool held for a judgment, then
// a path a running issue declares, then a pool with no lane left.
function offer_wait(child: EpicChild, read: ReasonRead, pool: Pool): string | undefined {
	if (pool.is_held) return WORDS.held

	const overlap = overlap_of(child, read, pool)

	if (overlap !== undefined) return overlap

	return read.free_lanes === NO_FREE_LANES ? WORDS.no_lane : undefined
}

function wait_of(child: EpicChild, read: ReasonRead, pool: Pool): RowReason | undefined {
	if (!epic_triage.is_triaged(child)) return { text: WORDS.untriaged }
	if (run_board_layout.is_blocked(child, read)) return undefined

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

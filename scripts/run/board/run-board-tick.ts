import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { run_progress } from '#scripts/run/progress/run-progress'
import { run_progress_cli } from '#scripts/run/progress/run-progress-cli'
import { run_board_header } from './run-board-header'
import type { Words } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardPlan } from './run-board-layout'
import { run_board_notes } from './run-board-notes'
import { run_board_render } from './run-board-render'
import { run_board_status } from './run-board-status'

// One `run:board` redraw (joshuafolkken/kit#3430). **Three speeds** (joshuafolkken/kit#3444): the frame
// is redrawn every second so the elapsed times move; the run's own stream and lanes are re-read no more
// often than `LOCAL_READ_MS`, because each read parses the whole stream and asks git twice, and a board
// left open all night would otherwise grow heavier as the run grew longer; the plan they are laid over
// is a GitHub read taken no more often than `run:progress` re-reads after a decline. Between reads the
// last one is kept and drawn against the current time. A failed plan read keeps the previous plan on
// screen and says when it failed. With no run in this checkout it reads nothing from GitHub.

const REDRAW_SECONDS = 1
const REDRAW_MS = REDRAW_SECONDS * run_progress.MS_PER_SECOND
const LOCAL_READ_SECONDS = 5
const LOCAL_READ_MS = LOCAL_READ_SECONDS * run_progress.MS_PER_SECOND
const PLAN_RETRY_MS = run_progress_cli.DECLINE_RETRY_SECONDS * run_progress.MS_PER_SECOND

// What the board reads locally: the run's start and scope, its events and its open lanes.
interface LocalRead {
	started_ms: number
	// What the run was asked to do, from the carry record's invocation (joshuafolkken/kit#3442).
	scope: NamedPlan
	events: ReadonlyArray<RunEvent>
	lanes: ReadonlyArray<string>
}

interface BoardPorts {
	read_plan: (scope: NamedPlan) => Promise<BoardPlan | undefined>
	// `undefined` when no run has started here.
	read_local: () => Promise<LocalRead | undefined>
	now: () => number
	write: (frame: string) => void
	// Whether stdout is a terminal — only a terminal gets the alternate screen.
	is_tty: boolean
	// Runs `leave` however the process ends: a normal exit, Ctrl+C or SIGTERM.
	on_exit: (leave: () => void) => void
	sleep: (ms: number) => Promise<void>
}

interface BoardState {
	// The last local read, drawn until the next is due; `undefined` when no run had started.
	local: LocalRead | undefined
	read_ms: number | undefined
	plan: BoardPlan | undefined
	attempted_ms: number | undefined
	fetched_ms: number | undefined
	failed_ms: number | undefined
	baseline_total: number | undefined
}

const FRESH_STATE: BoardState = {
	local: undefined,
	read_ms: undefined,
	plan: undefined,
	attempted_ms: undefined,
	fetched_ms: undefined,
	failed_ms: undefined,
	baseline_total: undefined,
}

function is_due(last_ms: number | undefined, interval_ms: number, now_ms: number): boolean {
	return last_ms === undefined || now_ms - last_ms >= interval_ms
}

async function reread(state: BoardState, ports: BoardPorts, now_ms: number): Promise<BoardState> {
	if (!is_due(state.read_ms, LOCAL_READ_MS, now_ms)) return state

	return { ...state, local: await ports.read_local(), read_ms: now_ms }
}

// A title the board once knew stays known, so an issue that left the open listing keeps its name.
function with_titles(plan: BoardPlan, previous: BoardPlan | undefined): BoardPlan {
	const titles = new Map([...(previous?.context.titles ?? []), ...plan.context.titles])

	return { ...plan, context: { ...plan.context, titles } }
}

async function refresh(
	state: BoardState,
	ports: BoardPorts,
	local: LocalRead,
	now_ms: number,
): Promise<BoardState> {
	if (!is_due(state.attempted_ms, PLAN_RETRY_MS, now_ms)) return state

	const plan = await ports.read_plan(local.scope)
	const attempted = { ...state, attempted_ms: now_ms }

	if (plan === undefined) return { ...attempted, failed_ms: now_ms }

	return {
		...attempted,
		plan: with_titles(plan, state.plan),
		fetched_ms: now_ms,
		failed_ms: undefined,
	}
}

// The statuses scoped to the run's plan, a running child the plan's listing no longer holds settled.
function layout_for(state: BoardState, local: LocalRead): BoardLayout | undefined {
	const { plan } = state

	if (plan === undefined) return undefined

	const in_run = run_board_layout.numbers_of(plan)
	const statuses = run_board_status.statuses_of(local.events, local.lanes, in_run)
	const read = { open_numbers: plan.context.open_numbers, read_ms: state.fetched_ms }

	return run_board_layout.layout_of(plan, run_board_status.settle_closed(statuses, read))
}

// What one redraw draws with.
interface Redraw {
	ports: BoardPorts
	words: Words
	now_ms: number
}

function frame_of(
	state: BoardState,
	local: LocalRead,
	layout: BoardLayout | undefined,
	redraw: Redraw,
): Array<string> {
	const header = {
		now_ms: redraw.now_ms,
		words: redraw.words,
		started_ms: local.started_ms,
		activity: run_board_status.activity_of(local.events),
		layout,
		baseline_total: state.baseline_total,
		plan_fetched_ms: state.fetched_ms,
		plan_failed_ms: state.failed_ms,
	}

	return run_board_render.render({ header, notes: run_board_notes.notes_of(local.events) })
}

function draw(ports: BoardPorts, lines: ReadonlyArray<string>): void {
	ports.write(`${lines.join('\n')}\n`)
}

// The first total the board sees is the baseline every later arrival is counted against.
function draw_run(state: BoardState, local: LocalRead, redraw: Redraw): BoardState {
	const layout = layout_for(state, local)
	const first_total = layout === undefined ? undefined : run_board_header.counts_of(layout).total
	const settled = { ...state, baseline_total: state.baseline_total ?? first_total }

	draw(redraw.ports, frame_of(settled, local, layout, redraw))

	return settled
}

// One redraw. No run reads nothing from GitHub and keeps the plan it had for when one starts.
async function tick(state: BoardState, ports: BoardPorts, words: Words): Promise<BoardState> {
	const now_ms = ports.now()
	const read = await reread(state, ports, now_ms)
	const { local } = read

	if (local === undefined) {
		draw(ports, run_board_render.render_no_run(now_ms, words))

		return read
	}

	return draw_run(await refresh(read, ports, local, now_ms), local, { ports, words, now_ms })
}

const run_board_tick = { FRESH_STATE, LOCAL_READ_MS, PLAN_RETRY_MS, REDRAW_MS, tick }

export { run_board_tick }
export type { BoardPorts, BoardState, LocalRead }

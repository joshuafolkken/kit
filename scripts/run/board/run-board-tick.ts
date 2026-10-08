import { run_progress } from '#scripts/run/progress/run-progress'
import type { ClosedIssue } from './run-board-closed'
import { run_board_github } from './run-board-github'
import { run_board_header } from './run-board-header'
import { run_board_labels, type Words } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardPlan } from './run-board-layout'
import { run_board_link } from './run-board-link'
import { run_board_machine } from './run-board-machine'
import { run_board_notes } from './run-board-notes'
import type { LocalRead } from './run-board-read'
import { run_board_render } from './run-board-render'
import { run_board_state, type BoardPorts, type BoardState, type Pace } from './run-board-state'
import { run_board_status } from './run-board-status'

// One `run:board` redraw (joshuafolkken/kit#3430). **Three speeds** (joshuafolkken/kit#3444): the frame
// is redrawn every second so the elapsed times move; the run's own stream and lanes are re-read no more
// often than `LOCAL_READ_MS`, because each read parses the whole stream and asks git twice, and a board
// left open all night would otherwise grow heavier as the run grew longer; the GitHub reads they are
// laid over are `run-board-github.ts`'s, which a live board never waits on (joshuafolkken/kit#3455).
// Between reads the last one is kept and drawn against the current time. A run that ended stays on
// screen until the next one starts (joshuafolkken/kit#3439). With no run in this checkout it reads
// nothing from GitHub. The machine is sampled once a second (joshuafolkken/kit#3450): one `sysctl`
// takes a few milliseconds, and its gauges are the differences between consecutive samples. **The
// redraw is four times faster than every read** (joshuafolkken/kit#3452), so the spinner turns while
// nothing is read any more often than it was.

const REDRAW_MS = run_board_labels.SPINNER_FRAME_MS
const MACHINE_SAMPLE_MS = run_progress.MS_PER_SECOND
const LOCAL_READ_SECONDS = 5
const LOCAL_READ_MS = LOCAL_READ_SECONDS * run_progress.MS_PER_SECOND
const { FRESH_STATE, is_due } = run_board_state
const { PLAN_RETRY_MS, gather_github, statuses_for } = run_board_github

async function reread(state: BoardState, ports: BoardPorts, now_ms: number): Promise<BoardState> {
	if (!is_due(state.read_ms, LOCAL_READ_MS, now_ms)) return state

	return { ...state, local: await ports.read_local(), read_ms: now_ms }
}

// The sample is timed when it is taken, not when the tick began: a plan read between the two would put
// its seconds on the wrong side of the rate's interval. It is due by the tick's clock, so a sample
// taken a few milliseconds into its tick does not slip to the redraw after the second.
async function resample(state: BoardState, ports: BoardPorts, now_ms: number): Promise<BoardState> {
	if (!is_due(state.sampled_ms, MACHINE_SAMPLE_MS, now_ms)) return state

	const at_ms = ports.now()
	const machine = { sample: await ports.read_machine(), at_ms }
	const gauges = run_board_machine.gauges_of(state.machine, machine)

	return { ...state, machine, gauges, sampled_ms: now_ms }
}

// The state of the run on screen; a different run starts its plan state from nothing, so no row, count
// or baseline of the previous run is drawn over the new one (joshuafolkken/kit#3439).
function state_for(state: BoardState, local: LocalRead): BoardState {
	if (state.run_started_ms === local.started_ms) return state

	const { local: kept, read_ms } = state

	return { ...FRESH_STATE, local: kept, read_ms, run_started_ms: local.started_ms }
}

// The plan with a closed child's title under the listing's own.
function titled_closed(plan: BoardPlan, closed: ReadonlyMap<number, ClosedIssue>): BoardPlan {
	const closed_titles = [...closed].map(([issue, { title }]) => [issue, title] as const)
	const titles = new Map([...closed_titles, ...plan.context.titles])

	return { ...plan, context: { ...plan.context, titles } }
}

// The statuses scoped to the run's plan, a running child the plan's listing no longer holds settled.
function layout_for(state: BoardState, local: LocalRead): BoardLayout | undefined {
	const { plan, closed } = state

	if (plan === undefined) return undefined

	const read = {
		open_numbers: plan.context.open_numbers,
		read_ms: state.fetched_ms,
		closed,
		labels: plan.labels,
	}
	const statuses = run_board_status.settle_closed(statuses_for(plan, local), read)

	return run_board_layout.layout_of(titled_closed(plan, closed), statuses)
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
		ended_ms: local.ended_ms,
		activity: run_board_status.activity_of(local.events, local.ended_ms !== undefined),
		layout,
		baseline_total: state.baseline_total,
		plan_fetched_ms: state.fetched_ms,
		plan_failed_ms: state.failed_ms,
		is_plan_loading: state.plan_fetch !== undefined,
		machine: state.gauges,
		form: redraw.ports.form,
		spinner: redraw.ports.is_tty ? run_board_labels.spinner_of(redraw.now_ms) : undefined,
		link: run_board_link.linker(state.plan?.context.repo, redraw.ports.link),
	}

	const notes = run_board_notes.notes_of(local.events)

	return run_board_render.render({ header, notes, resume: local.resume })
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

// One redraw. No run reads nothing from GitHub and keeps the plan it had for when one starts. A live
// board redraws at the `background` pace; one plain frame waits for the GitHub reads.
async function tick(
	state: BoardState,
	ports: BoardPorts,
	words: Words,
	pace: Pace = 'settled',
): Promise<BoardState> {
	const now_ms = ports.now()
	const read = await reread(state, ports, now_ms)
	const { local } = read

	if (local === undefined) {
		draw(ports, run_board_render.render_no_run(now_ms, words))

		return read
	}

	const gathered = await gather_github(state_for(read, local), { ports, local, now_ms, pace })

	return draw_run(await resample(gathered, ports, now_ms), local, { ports, words, now_ms })
}

const run_board_tick = {
	FRESH_STATE,
	LOCAL_READ_MS,
	MACHINE_SAMPLE_MS,
	PLAN_RETRY_MS,
	REDRAW_MS,
	tick,
}

export { run_board_tick }

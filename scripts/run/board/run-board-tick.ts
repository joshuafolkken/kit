import { run_progress } from '#scripts/run/progress/run-progress'
import type { ClosedIssue } from './run-board-closed'
import { run_board_github } from './run-board-github'
import { run_board_header, type BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardPlan } from './run-board-layout'
import { run_board_link } from './run-board-link'
import { run_board_machine } from './run-board-machine'
import { run_board_notes, type Titles } from './run-board-notes'
import type { LocalRead } from './run-board-read'
import { run_board_render, type FrameBounds } from './run-board-render'
import { run_board_spin, type Spun } from './run-board-spin'
import { run_board_state, type BoardPorts, type BoardState, type Pace } from './run-board-state'
import { run_board_status } from './run-board-status'
import { run_board_usage } from './run-board-usage'

// One `run:board` redraw. **Three speeds**: the frame is redrawn once a second, on the second, so
// every elapsed time moves by one, its spinners turned between redraws by `run-board-spin.ts`; the
// run's own stream and lanes are re-read no more often than `LOCAL_READ_MS`, because each read parses
// the whole stream and asks git twice, and a board left open all night would otherwise grow heavier
// as the run grew longer; the GitHub reads they are laid over are `run-board-github.ts`'s, which a
// live board never waits on. Between reads the last one is kept and drawn against the current time.
// A run that ended stays on screen until the next one starts. With no run in this checkout it reads
// nothing from GitHub. The machine is sampled once a second: one `sysctl` takes a few milliseconds,
// and its gauges are the differences between consecutive samples.

const { REDRAW_MS, SPOT } = run_board_spin
const MACHINE_SAMPLE_MS = run_progress.MS_PER_SECOND
const LOCAL_READ_SECONDS = 5
const LOCAL_READ_MS = LOCAL_READ_SECONDS * run_progress.MS_PER_SECOND
const { FRESH_STATE, is_due } = run_board_state
const { PLAN_RETRY_MS, gather_github, statuses_for } = run_board_github

async function reread(state: BoardState, ports: BoardPorts, now_ms: number): Promise<BoardState> {
	if (!is_due(state.read_ms, LOCAL_READ_MS, now_ms)) return state

	return { ...state, local: await ports.read_local(), read_ms: now_ms }
}

// Each lane's usage, read on the machine's second. A chat draws none, so it reads none; a reading
// that failed draws no column.
async function read_usages(
	state: BoardState,
	ports: BoardPorts,
): Promise<Pick<BoardState, 'usage' | 'usages'>> {
	const usage = ports.form === 'chat' ? undefined : await ports.read_usage(state.usage)
	const usages = usage === undefined ? undefined : run_board_usage.usage_of(state.usage, usage)

	return { usage, usages }
}

// The sample is timed when it is taken, not when the tick began: a plan read between the two would put
// its seconds on the wrong side of the rate's interval. It is due by the tick's clock, so a sample
// taken a few milliseconds into its tick does not slip to the redraw after the second.
async function resample(state: BoardState, ports: BoardPorts, now_ms: number): Promise<BoardState> {
	if (!is_due(state.sampled_ms, MACHINE_SAMPLE_MS, now_ms)) return state

	const at_ms = ports.now()
	const machine = { sample: await ports.read_machine(), at_ms }
	const gauges = run_board_machine.gauges_of(state.machine, machine)

	return { ...state, ...(await read_usages(state, ports)), machine, gauges, sampled_ms: now_ms }
}

// The state of the run on screen; a different run starts its plan state from nothing, so no row, count
// or baseline of the previous run is drawn over the new one.
function state_for(state: BoardState, local: LocalRead): BoardState {
	if (state.run_started_ms === local.started_ms) return state

	const { local: kept, read_ms } = state

	return { ...FRESH_STATE, local: kept, read_ms, run_started_ms: local.started_ms }
}

// The plan with a closed child's title and labels under the listing's own.
function with_closed(plan: BoardPlan, closed: ReadonlyMap<number, ClosedIssue>): BoardPlan {
	const closed_titles = [...closed].map(([issue, { title }]) => [issue, title] as const)
	const closed_labels = [...closed].map(([issue, { labels }]) => [issue, labels] as const)
	const titles = new Map([...closed_titles, ...plan.context.titles])
	const labels = new Map([...closed_labels, ...plan.labels])

	return { ...plan, context: { ...plan.context, titles }, labels }
}

// The titles the findings name a parked issue by — the rows' own; none before the plan is read.
function titles_of(state: BoardState): Titles {
	if (state.plan === undefined) return new Map()

	return with_closed(state.plan, state.closed).context.titles
}

// The statuses scoped to the run's plan, a running child the plan's listing no longer holds settled.
// Before the plan is read, the run's own children alone.
function layout_for(state: BoardState, local: LocalRead): BoardLayout {
	const { plan, closed } = state

	if (plan === undefined) {
		return run_board_layout.local_layout_of(
			run_board_status.statuses_of(local.events, local.lanes, new Set()),
		)
	}

	const read = {
		open_numbers: plan.context.open_numbers,
		read_ms: state.fetched_ms,
		closed,
		labels: plan.labels,
	}
	const statuses = run_board_status.settle_closed(statuses_for(plan, local), read)

	return run_board_layout.layout_of(with_closed(plan, closed), statuses)
}

// What one redraw draws with.
interface Redraw {
	ports: BoardPorts
	now_ms: number
}

function header_of(
	state: BoardState,
	local: LocalRead,
	layout: BoardLayout,
	redraw: Redraw,
): BoardHeader {
	return {
		now_ms: redraw.now_ms,
		started_ms: local.started_ms,
		ended_ms: local.ended_ms,
		activity: run_board_status.activity_of(local.events, local.ended_ms !== undefined),
		layout,
		baseline_total: state.baseline_total,
		plan_fetched_ms: state.fetched_ms,
		plan_failed_ms: state.failed_ms,
		is_plan_loading: state.plan_fetch !== undefined,
		machine: state.gauges,
		usages: state.usages,
		form: redraw.ports.form,
		spinner: redraw.ports.is_tty ? SPOT : undefined,
		link: run_board_link.linker(state.plan?.context.repo, redraw.ports.link),
	}
}

// The pane a live frame is kept within and the footer it ends on, read at every redraw.
function bounds_of(ports: BoardPorts): FrameBounds {
	return { size: ports.size?.(), footer: ports.footer }
}

// The frame with its spinners drawn at this moment's frame, and where they are on screen.
function frame_of(state: BoardState, local: LocalRead, layout: BoardLayout, redraw: Redraw): Spun {
	const bounds = bounds_of(redraw.ports)
	const lines = run_board_render.render({
		header: header_of(state, local, layout, redraw),
		notes: run_board_notes.notes_of(local.events, titles_of(state)),
		resume: local.resume,
		...bounds,
	})

	return run_board_spin.spun(lines, run_board_labels.spinner_of(redraw.now_ms), bounds.size)
}

function draw(ports: BoardPorts, lines: ReadonlyArray<string>): void {
	ports.write(`${lines.join('\n')}\n`)
}

// The first total the plan gives is the baseline every later arrival is counted against; the run's own
// children before it are no total.
function draw_run(state: BoardState, local: LocalRead, redraw: Redraw): BoardState {
	const layout = layout_for(state, local)
	const first_total =
		state.plan === undefined ? undefined : run_board_header.counts_of(layout).total
	const settled = { ...state, baseline_total: state.baseline_total ?? first_total }
	const { lines, spots } = frame_of(settled, local, layout, redraw)

	draw(redraw.ports, lines)

	return { ...settled, spots }
}

// One redraw. No run reads nothing from GitHub and keeps the plan it had for when one starts. A live
// board redraws at the `background` pace; one plain frame waits for the GitHub reads.
async function tick(
	state: BoardState,
	ports: BoardPorts,
	pace: Pace = 'settled',
): Promise<BoardState> {
	const now_ms = ports.now()
	const read = await reread(state, ports, now_ms)
	const { local } = read

	if (local === undefined) {
		draw(ports, run_board_render.render_no_run(now_ms, bounds_of(ports)))

		return { ...read, spots: [] }
	}

	const gathered = await gather_github(state_for(read, local), { ports, local, now_ms, pace })

	return draw_run(await resample(gathered, ports, now_ms), local, { ports, now_ms })
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

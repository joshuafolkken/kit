import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import type { MachineSample } from '#scripts/gate/machine-capacity'
import { run_progress } from '#scripts/run/progress/run-progress'
import { run_progress_cli } from '#scripts/run/progress/run-progress-cli'
import type { ClosedIssue } from './run-board-closed'
import { run_board_header } from './run-board-header'
import { run_board_labels, type Words } from './run-board-labels'
import { run_board_layout, type BoardLayout, type BoardPlan } from './run-board-layout'
import { run_board_link, type Link } from './run-board-link'
import { run_board_machine, type MachineGauges, type MachineMark } from './run-board-machine'
import { run_board_notes } from './run-board-notes'
import type { LocalRead } from './run-board-read'
import { run_board_render } from './run-board-render'
import { run_board_status, type ItemStatus } from './run-board-status'

// One `run:board` redraw (joshuafolkken/kit#3430). **Three speeds** (joshuafolkken/kit#3444): the frame
// is redrawn every second so the elapsed times move; the run's own stream and lanes are re-read no more
// often than `LOCAL_READ_MS`, because each read parses the whole stream and asks git twice, and a board
// left open all night would otherwise grow heavier as the run grew longer; the plan they are laid over
// is a GitHub read taken no more often than `run:progress` re-reads after a decline. Between reads the
// last one is kept and drawn against the current time. A failed plan read keeps the previous plan on
// screen and says when it failed. A run that ended stays on screen, its plan held as it last read,
// until the next one starts (joshuafolkken/kit#3439). With no run in this checkout it reads nothing
// from GitHub. The machine is sampled once a second (joshuafolkken/kit#3450): one `sysctl` takes a few
// milliseconds, and its gauges are the differences between consecutive samples. **The redraw is four
// times faster than every read** (joshuafolkken/kit#3452), so the spinner turns while nothing is read
// any more often than it was.

const REDRAW_MS = run_board_labels.SPINNER_FRAME_MS
const MACHINE_SAMPLE_MS = run_progress.MS_PER_SECOND
const LOCAL_READ_SECONDS = 5
const LOCAL_READ_MS = LOCAL_READ_SECONDS * run_progress.MS_PER_SECOND
const PLAN_RETRY_MS = run_progress_cli.DECLINE_RETRY_SECONDS * run_progress.MS_PER_SECOND

interface BoardPorts {
	read_plan: (scope: NamedPlan) => Promise<BoardPlan | undefined>
	// `undefined` when no run has started here.
	read_local: () => Promise<LocalRead | undefined>
	read_machine: () => Promise<MachineSample>
	// The issues that answered as closed, by number (`run-board-closed.ts`).
	read_closed: (issues: ReadonlyArray<number>) => Promise<ReadonlyMap<number, ClosedIssue>>
	now: () => number
	write: (frame: string) => void
	// Wraps an issue number in a hyperlink where the terminal opens one, and leaves it plain elsewhere.
	link: Link
	// Whether stdout is a terminal — only a terminal gets the alternate screen and the spinner.
	is_tty: boolean
	// Runs `leave` however the process ends: a normal exit, Ctrl+C or SIGTERM.
	on_exit: (leave: () => void) => void
	sleep: (ms: number) => Promise<void>
}

interface BoardState {
	// The last local read, drawn until the next is due; `undefined` when no run had started.
	local: LocalRead | undefined
	read_ms: number | undefined
	// The start of the run the plan state was built for, so a run that begins draws nothing of the last.
	run_started_ms: number | undefined
	plan: BoardPlan | undefined
	attempted_ms: number | undefined
	fetched_ms: number | undefined
	failed_ms: number | undefined
	baseline_total: number | undefined
	// The run's children read closed, kept for the run: a closed issue's answer does not change.
	closed: ReadonlyMap<number, ClosedIssue>
	closed_attempted_ms: number | undefined
	// The last machine sample, which the next one is compared against, and the gauges drawn from them.
	machine: MachineMark | undefined
	gauges: MachineGauges | undefined
	// The redraw the last sample was taken on, which the next sample is due a second after.
	sampled_ms: number | undefined
}

const FRESH_STATE: BoardState = {
	local: undefined,
	read_ms: undefined,
	run_started_ms: undefined,
	plan: undefined,
	attempted_ms: undefined,
	fetched_ms: undefined,
	failed_ms: undefined,
	baseline_total: undefined,
	closed: new Map(),
	closed_attempted_ms: undefined,
	machine: undefined,
	gauges: undefined,
	sampled_ms: undefined,
}

function is_due(last_ms: number | undefined, interval_ms: number, now_ms: number): boolean {
	return last_ms === undefined || now_ms - last_ms >= interval_ms
}

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

// A title the board once knew stays known, so an issue that left the open listing keeps its name.
function with_titles(plan: BoardPlan, previous: BoardPlan | undefined): BoardPlan {
	const titles = new Map([...(previous?.context.titles ?? []), ...plan.context.titles])

	return { ...plan, context: { ...plan.context, titles } }
}

// The state of the run on screen; a different run starts its plan state from nothing, so no row, count
// or baseline of the previous run is drawn over the new one (joshuafolkken/kit#3439).
function state_for(state: BoardState, local: LocalRead): BoardState {
	if (state.run_started_ms === local.started_ms) return state

	const { local: kept, read_ms } = state

	return { ...FRESH_STATE, local: kept, read_ms, run_started_ms: local.started_ms }
}

// An ended run's plan is read until it lands once, then held: the board keeps that run's screen.
function is_plan_due(state: BoardState, local: LocalRead, now_ms: number): boolean {
	if (local.ended_ms !== undefined && state.fetched_ms !== undefined) return false

	return is_due(state.attempted_ms, PLAN_RETRY_MS, now_ms)
}

async function refresh(
	state: BoardState,
	ports: BoardPorts,
	local: LocalRead,
	now_ms: number,
): Promise<BoardState> {
	if (!is_plan_due(state, local, now_ms)) return state

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

function statuses_for(plan: BoardPlan, local: LocalRead): ReadonlyMap<number, ItemStatus> {
	return run_board_status.statuses_of(local.events, local.lanes, run_board_layout.numbers_of(plan))
}

// The children the run touched that the open listing no longer holds and the board has not read yet
// (joshuafolkken/kit#3451). A listing cut short proves nothing missing, so it asks about none.
function unread_closed(state: BoardState, local: LocalRead): Array<number> {
	const open = state.plan?.context.open_numbers

	if (open === undefined || state.plan === undefined) return []

	const touched = [...statuses_for(state.plan, local).keys()]

	return touched.filter((issue) => !open.has(issue) && !state.closed.has(issue))
}

// Reads a closed child once and keeps the answer; one that has not answered closed is asked again no
// sooner than the plan is.
async function read_closed(
	state: BoardState,
	ports: BoardPorts,
	local: LocalRead,
	now_ms: number,
): Promise<BoardState> {
	const unread = unread_closed(state, local)

	if (unread.length === 0 || !is_due(state.closed_attempted_ms, PLAN_RETRY_MS, now_ms)) return state

	const closed = new Map([...state.closed, ...(await ports.read_closed(unread))])

	return { ...state, closed, closed_attempted_ms: now_ms }
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
		machine: state.gauges,
		spinner: redraw.ports.is_tty ? run_board_labels.spinner_of(redraw.now_ms) : undefined,
		link: run_board_link.linker(state.plan?.context.repo, redraw.ports.link),
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

	const refreshed = await refresh(state_for(read, local), ports, local, now_ms)
	const sampled = await resample(await read_closed(refreshed, ports, local, now_ms), ports, now_ms)

	return draw_run(sampled, local, { ports, words, now_ms })
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
export type { BoardPorts, BoardState }

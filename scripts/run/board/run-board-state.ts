import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import type { MachineSample } from '#scripts/gate/machine-capacity'
import type { ClosedAnswer, ClosedIssue } from './run-board-closed'
import type { Fetch } from './run-board-fetch'
import type { TerminalSize } from './run-board-fit'
import type { BoardForm } from './run-board-header'
import type { BoardPlan } from './run-board-layout'
import type { Link } from './run-board-link'
import type { MachineGauges, MachineMark } from './run-board-machine'
import type { LocalRead } from './run-board-read'
import type { Spot } from './run-board-spin'
import type { LaneUsages, UsageMark } from './run-board-usage'

// What a `run:board` redraw reads through and folds forward, shared by the
// redraw (`run-board-tick.ts`) and its GitHub reads (`run-board-github.ts`).

interface BoardPorts {
	read_plan: (scope: NamedPlan) => Promise<BoardPlan | undefined>
	// `undefined` when no run has started here.
	read_local: () => Promise<LocalRead | undefined>
	read_machine: () => Promise<MachineSample>
	// Every process and its lane, the last reading's lanes reused (`run-board-usage-read.ts`).
	read_usage: (before: UsageMark | undefined) => Promise<UsageMark | undefined>
	// The issues that answered as closed, and whether every issue answered (`run-board-closed.ts`).
	read_closed: (issues: ReadonlyArray<number>) => Promise<ClosedAnswer>
	now: () => number
	write: (frame: string) => void
	// Wraps an issue number in a hyperlink where the terminal opens one, and leaves it plain elsewhere.
	link: Link
	// Whether stdout is a terminal — only a terminal gets the alternate screen and the spinner.
	is_tty: boolean
	// The terminal a live frame is kept within, read at every redraw so a resized pane is fitted on the
	// next one; none where the frame is drawn whole — one frame, a pipe, a chat.
	size?: (() => TerminalSize) | undefined
	// The lines a live frame ends on, the first to give way to a short pane.
	footer?: ReadonlyArray<string> | undefined
	form: BoardForm
	// Records that a progress report was just given, as `run:progress --mark` does, so the next scheduled
	// one waits a full interval from here.
	mark: () => Promise<void>
	// Sends one chat frame off-screen, for `--every` alone.
	push: (frame: string) => Promise<void>
	// Runs `leave` however the process ends: a normal exit, Ctrl+C or SIGTERM.
	on_exit: (leave: () => void) => void
	sleep: (ms: number) => Promise<void>
}

// `background` launches the GitHub reads and draws without them; `settled` waits for them before
// drawing.
type Pace = 'background' | 'settled'

interface BoardState {
	// The last local read, drawn until the next is due; `undefined` when no run had started.
	local: LocalRead | undefined
	read_ms: number | undefined
	// The start of the run the plan state was built for, so a run that begins draws nothing of the last.
	run_started_ms: number | undefined
	plan: BoardPlan | undefined
	// The plan read in flight, `undefined` once it has been folded in.
	plan_fetch: Fetch<BoardPlan | undefined> | undefined
	attempted_ms: number | undefined
	fetched_ms: number | undefined
	failed_ms: number | undefined
	baseline_total: number | undefined
	// The run's children read closed, kept for the run: a closed issue's answer does not change.
	closed: ReadonlyMap<number, ClosedIssue>
	closed_fetch: Fetch<ClosedAnswer> | undefined
	closed_attempted_ms: number | undefined
	// The last ask every child answered, open or closed; a failed read leaves it where it was.
	closed_answered_ms: number | undefined
	// The last machine sample, which the next one is compared against, and the gauges drawn from them.
	machine: MachineMark | undefined
	gauges: MachineGauges | undefined
	// The redraw the last sample was taken on, which the next sample is due a second after.
	sampled_ms: number | undefined
	// Where the last frame drew its spinners, turned between redraws.
	spots: ReadonlyArray<Spot>
	// The last process reading, which the next one is compared against, and each lane's usage drawn from
	// them.
	usage: UsageMark | undefined
	usages: LaneUsages | undefined
}

const FRESH_STATE: BoardState = {
	local: undefined,
	read_ms: undefined,
	run_started_ms: undefined,
	plan: undefined,
	plan_fetch: undefined,
	attempted_ms: undefined,
	fetched_ms: undefined,
	failed_ms: undefined,
	baseline_total: undefined,
	closed: new Map(),
	closed_fetch: undefined,
	closed_attempted_ms: undefined,
	closed_answered_ms: undefined,
	machine: undefined,
	gauges: undefined,
	sampled_ms: undefined,
	spots: [],
	usage: undefined,
	usages: undefined,
}

function is_due(last_ms: number | undefined, interval_ms: number, now_ms: number): boolean {
	return last_ms === undefined || now_ms - last_ms >= interval_ms
}

const run_board_state = { FRESH_STATE, is_due }

export { run_board_state }
export type { BoardPorts, BoardState, Pace }

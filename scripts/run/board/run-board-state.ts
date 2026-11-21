import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import type { ClosedAnswer, ClosedIssue } from './run-board-closed'
import type { RuleCell } from './run-board-codes'
import type { BoardDisplay } from './run-board-display'
import type { Fetch } from './run-board-fetch'
import type { SectionKey, TerminalSize } from './run-board-fit'
import type { FrameStore } from './run-board-frame-store'
import type { GatherRead } from './run-board-gather'
import type { BoardForm } from './run-board-header'
import type { Notice } from './run-board-header-notice'
import type { WorkerHeap } from './run-board-heap'
import { run_board_idle } from './run-board-idle'
import type { IssueCount } from './run-board-issue-count'
import type { KeyInput } from './run-board-keys'
import type { Lamp } from './run-board-lamp-spots'
import type { BoardPlan } from './run-board-layout'
import type { Link } from './run-board-link'
import type { GithubRateLimit } from './run-board-render-quota-github'
import { run_board_snapshot, type Known, type SnapshotStore } from './run-board-snapshot'
import type { CueName } from './run-board-sound-cues'
import type { Pending } from './run-board-sound-repeat'
import type { SoundSnapshot } from './run-board-sound-transition'
import type { TypingSound } from './run-board-sound-typing'
import type { Spot } from './run-board-spin'
import type { StripCell } from './run-board-strip'
import type { Sweep } from './run-board-sweep'
import type { Thanks } from './run-board-thanks-csv'
import type { Theme } from './run-board-theme-defs'
import { run_board_type_rows, type Typing } from './run-board-type-rows'

// What a `run:board` redraw reads through and folds forward, shared by the
// redraw (`run-board-tick.ts`) and its GitHub reads (`run-board-github.ts`).

// A redraw's whole frame (`tick`) or the spinners and typing written between redraws (`turn`).
type DrawKind = 'tick' | 'turn'
type DrawTimer = <T>(kind: DrawKind, draw: () => T) => T
// The stage a live board's loop is in, which `--timing` names a main-thread stall by (joshuafolkken/kit#8148).
// `turn` is the spinners turned between seconds.
type StallStage = 'redraw' | 'turn'

interface BoardPorts {
	read_plan: (scope: NamedPlan) => Promise<BoardPlan | undefined>
	// The reads off this machine a redraw draws from (`run-board-gather.ts`): a live board's come from
	// a worker thread, so no read stops its spinner, with the GitHub reads it folded over them.
	gather: (pace: Pace) => Promise<BoardGather>
	// The gather worker's heap, which only `--timing` reads (`run-board-heap.ts`); none where no worker
	// gathers.
	worker_heap?: WorkerHeap | undefined
	// The issues that answered as closed, and whether every issue answered (`run-board-closed.ts`).
	read_closed: (issues: ReadonlyArray<number>) => Promise<ClosedAnswer>
	// Where the last GitHub reads are kept between boards (`run-board-snapshot.ts`); none keeps nothing.
	snapshot?: SnapshotStore | undefined
	// Where `--chat` and `--once` keep the frame they drew (`run-board-frame-store.ts`); none keeps nothing.
	frames?: FrameStore | undefined
	now: () => number
	write: (frame: string) => void
	// Writes text a theme already drew, past the theme `write` puts it through; none where no theme
	// draws, so `write` takes it.
	write_drawn?: ((text: string) => void) | undefined
	// Wraps an issue number in a hyperlink where the terminal opens one, and leaves it plain elsewhere.
	link: Link
	// Whether stdout is a terminal — only a terminal gets the alternate screen and the spinner.
	is_tty: boolean
	// Whether a live board types each issue row that appears, a letter at a time — only in a theme.
	types_rows?: boolean | undefined
	// The theme the frame is drawn in (`run-board-theme.ts`), whose alert display the header adds.
	theme?: Theme | undefined
	// The terminal a live frame is kept within, read at every redraw so a resized pane is fitted on the
	// next one; none where the frame is drawn whole — one frame, a pipe, a chat.
	size?: (() => TerminalSize) | undefined
	// The lines a live frame ends on, the first to give way to a short pane.
	footer?: ReadonlyArray<string> | undefined
	// The keyboard a live board folds its sections from (`run-board-keys.ts`); none where nobody types.
	keys?: KeyInput | undefined
	// The sections a person folded, read at every redraw; none where the frame folds nothing.
	folded?: (() => ReadonlySet<SectionKey>) | undefined
	// When a live board opened: a plan read before it is a saved one, drawn faint (joshuafolkken/kit#8219).
	opened_ms?: number | undefined
	form: BoardForm
	// Records that a progress report was just given, as `run:progress --mark` does, so the next scheduled
	// one waits a full interval from here.
	mark: () => Promise<void>
	// The reviewers' roster (`run-board-thanks-read.ts`); none where the frame thanks nobody — the chat.
	read_thanks?: (() => Promise<Thanks>) | undefined
	// GitHub's REST core and GraphQL allowances with the transport (`gh-core-rate-limit.ts`); none where
	// the frame shows none.
	read_rate_limit?: (() => Promise<GithubRateLimit | undefined>) | undefined
	// The repository's open and closed issues (`run-board-issue-count.ts`); none where none is read.
	read_issue_count?: ((repo: string) => Promise<IssueCount | undefined>) | undefined
	// Sends one chat frame off-screen, for `--every` alone.
	push: (frame: string) => Promise<void>
	// Runs `leave` however the process ends: a normal exit, Ctrl+C or SIGTERM.
	on_exit: (leave: () => void) => void
	sleep: (ms: number) => Promise<void>
	// The pauses of the line typed before a live board's first frame (`run-board-intro.ts`); none types no line.
	intro_sleep?: ((ms: number) => Promise<void>) | undefined
	// Sounds the cue a redraw picked (`run-board-sound-player.ts`), without waiting; the live board alone
	// passes one, so `--once`, `--chat` and `--every` stay silent.
	cue?: ((name: CueName) => void) | undefined
	// Whether the sound switch a person flips with `s` is on (`run-board-keys.ts`); none where no key is read.
	sound?: (() => boolean) | undefined
	// The trill sounded while a line types (`run-board-sound-typing.ts`): the live board alone passes
	// one, and only in a theme with the sound switch on does it reach the draws.
	typing_sound?: TypingSound | undefined
	// Times each draw for `--timing`'s report (`run-board-timing.ts`); none times nothing.
	time_draw?: DrawTimer | undefined
	// Marks the stage a live board's loop enters, for `--timing`'s stalls (`run-board-stall.ts`); none marks nothing.
	enter_stage?: ((stage: StallStage) => void) | undefined
}

// `background` launches the GitHub reads and draws without them; `settled` waits for them before
// drawing.
type Pace = 'background' | 'settled'

// The last reads off this machine, then what the board folds over them — the data a redraw draws
// from, apart from what the frame itself keeps between redraws (`BoardView`).
interface BoardData extends GatherRead {
	// The start of the run the plan state was built for, so a run that begins draws nothing of the last.
	run_started_ms: number | undefined
	plan: BoardPlan | undefined
	// The titles and labels drawn before this board's first plan lands — the last board's snapshot.
	known: Known
	// The plan read in flight, `undefined` once it has been folded in.
	plan_fetch: Fetch<BoardPlan | undefined> | undefined
	attempted_ms: number | undefined
	fetched_ms: number | undefined
	failed_ms: number | undefined
	// Why the last plan read failed, while it does (joshuafolkken/kit#8475).
	plan_error?: string | undefined
	// The run's children read closed, kept for the run: a closed issue's answer does not change.
	closed: ReadonlyMap<number, ClosedIssue>
	closed_fetch: Fetch<ClosedAnswer> | undefined
	closed_attempted_ms: number | undefined
	// The children the last closed read asked about — a child not among them is asked without waiting.
	closed_asked: ReadonlySet<number>
	// The last ask every child answered, open or closed; a failed read leaves it where it was.
	closed_answered_ms: number | undefined
	// The reviewers drawn above the legend, the read of them in flight, and when it was last launched.
	thanks: Thanks
	thanks_fetch: Fetch<Thanks> | undefined
	thanks_attempted_ms: number | undefined
	// The allowances drawn on the usage row — none once a read fails — the read in flight, and when
	// it was last launched.
	rate_limit: GithubRateLimit | undefined
	rate_limit_fetch: Fetch<GithubRateLimit | undefined> | undefined
	rate_limit_attempted_ms: number | undefined
	// The repository's issue count — none once a read fails — the read in flight, and when it was last
	// launched.
	issue_count: IssueCount | undefined
	issue_count_fetch: Fetch<IssueCount | undefined> | undefined
	issue_count_attempted_ms: number | undefined
}

// What the frame keeps between redraws: its spinners, typing, sound and notice, and the total it
// counts from.
interface BoardView {
	// The total the first frame counted, which later frames count their progress from.
	baseline_total: number | undefined
	// Where the last frame drew its spinners, turned between redraws.
	spots: ReadonlyArray<Spot>
	// Where the last frame has room for the sweep under its third line's age (`run-board-sweep.ts`), if anywhere.
	sweep?: Sweep | undefined
	// Where the last frame drew its lamp panel's lamps, blinked between redraws (`run-board-lamp-spots.ts`).
	lamps?: ReadonlyArray<Lamp> | undefined
	// Whether those cells run the idle rain in place of the lamps (`run-board-idle-rain.ts`).
	is_rain?: boolean | undefined
	// Where the last frame drew its worst-level TRACE field, blinked between redraws (`run-board-trace-spot.ts`).
	traces?: ReadonlyArray<Spot> | undefined
	// Where the last frame drew its section rules' cells, running code while a row types (`run-board-codes.ts`).
	rules?: ReadonlyArray<RuleCell> | undefined
	// Where the last frame has a lamp strip above a section rule, filled as a row types (`run-board-strip.ts`).
	strips?: ReadonlyArray<StripCell> | undefined
	// The rows the last frame drew and the ones typing, typed on between redraws (`run-board-type-rows.ts`).
	typing: Typing
	// The rows and run conditions the last frame sounded over, and the standing cue waiting to replay
	// (`run-board-sound-repeat.ts`); none before a run's first frame, so it sounds nothing already there.
	sound_snapshot?: SoundSnapshot | undefined
	sound_pending?: Pending | undefined
	// The last notice picked, kept while the sound is off too (`run-board-header-notice.ts`).
	notice?: Notice | undefined
}

type BoardState = BoardData & BoardView

// The reads a step of `BoardData` takes off GitHub and the disk (`run-board-data.ts`): a live board's
// on its worker thread, a single frame's where it draws.
type DataPorts = Pick<
	BoardPorts,
	'read_plan' | 'read_closed' | 'snapshot' | 'read_thanks' | 'read_rate_limit' | 'read_issue_count'
>

// The reads a board folds in on a later step, which hold a promise and so stay on the thread that launched them.
type FetchKey =
	'plan_fetch' | 'closed_fetch' | 'thanks_fetch' | 'rate_limit_fetch' | 'issue_count_fetch'

// `BoardData` as the worker thread posts it beside its reads off this machine: each read in flight
// named rather than held.
type DataPost = Omit<BoardData, keyof GatherRead | FetchKey> & {
	in_flight: ReadonlyArray<FetchKey>
}

// What a redraw gathers: the reads off this machine, and on a live board the data its worker folded over
// them and the frame it assembled over the run's read, which the board draws without the read itself.
type BoardGather = GatherRead & {
	data?: DataPost | undefined
	display?: BoardDisplay | undefined
}

const FRESH_DATA: BoardData = {
	local: undefined,
	read_ms: undefined,
	idle_since: run_board_idle.NO_IDLE,
	run_started_ms: undefined,
	plan: undefined,
	known: run_board_snapshot.NO_KNOWN,
	plan_fetch: undefined,
	attempted_ms: undefined,
	fetched_ms: undefined,
	failed_ms: undefined,
	closed: new Map(),
	closed_fetch: undefined,
	closed_attempted_ms: undefined,
	closed_asked: new Set(),
	closed_answered_ms: undefined,
	gauges: undefined,
	usages: undefined,
	budget_waits: [],
	thanks: [],
	thanks_fetch: undefined,
	thanks_attempted_ms: undefined,
	rate_limit: undefined,
	rate_limit_fetch: undefined,
	rate_limit_attempted_ms: undefined,
	issue_count: undefined,
	issue_count_fetch: undefined,
	issue_count_attempted_ms: undefined,
}

const FRESH_VIEW: BoardView = {
	baseline_total: undefined,
	spots: [],
	typing: run_board_type_rows.NO_TYPING,
}

const FRESH_STATE: BoardState = { ...FRESH_DATA, ...FRESH_VIEW }

function is_due(last_ms: number | undefined, interval_ms: number, now_ms: number): boolean {
	return last_ms === undefined || now_ms - last_ms >= interval_ms
}

const run_board_state = { FRESH_DATA, FRESH_STATE, FRESH_VIEW, is_due }

export { run_board_state }
export type {
	BoardData,
	BoardGather,
	BoardPorts,
	BoardState,
	BoardView,
	DataPorts,
	DataPost,
	DrawKind,
	DrawTimer,
	FetchKey,
	Pace,
	StallStage,
}

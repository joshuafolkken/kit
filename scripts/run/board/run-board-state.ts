import type { NamedPlan } from '#scripts/backlog/backlog-plan'
import type { ClosedAnswer, ClosedIssue } from './run-board-closed'
import type { BoardDisplay } from './run-board-display'
import type { Fetch } from './run-board-fetch'
import type { SectionKey, TerminalSize } from './run-board-fit'
import type { FrameStore } from './run-board-frame-store'
import type { GatherRead } from './run-board-gather'
import type { BoardForm } from './run-board-header'
import type { Notice } from './run-board-header-notice'
import type { WorkerHeap } from './run-board-heap'
import type { Icons } from './run-board-icons'
import { run_board_idle } from './run-board-idle'
import type { IssueCount } from './run-board-issue-count'
import type { KeyInput } from './run-board-keys'
import type { Lamp } from './run-board-lamp-spots'
import type { BoardPlan } from './run-board-layout'
import type { Link } from './run-board-link'
import type { PinnedIssue } from './run-board-pinned-graphql'
import type { GithubRateLimit } from './run-board-render-quota-github'
import type { Repaint } from './run-board-repaint'
import { run_board_snapshot, type Known, type SnapshotStore } from './run-board-snapshot'
import type { CueName } from './run-board-sound-cues'
import type { Pending } from './run-board-sound-repeat'
import type { SoundSnapshot } from './run-board-sound-transition'
import type { TypingSound } from './run-board-sound-typing'
import type { Spot } from './run-board-spin'
import type { Thanks } from './run-board-thanks-csv'
import type { Theme } from './run-board-theme-defs'
import type { ThemeRun } from './run-board-theme-run'
import { run_board_type_rows, type KeyedLine, type Typing } from './run-board-type-rows'

// What a `run:board` redraw reads through and folds forward, shared by the
// redraw (`run-board-tick.ts`) and its GitHub reads (`run-board-github.ts`).

// A redraw's whole frame (`tick`) or the spinners and typing written between redraws (`turn`); then the
// redraw stage's main-thread work outside its draw (joshuafolkken/kit#8825): a worker round received
// (`receive`), the view stepped over it (`view`), the opening typed and the first frame revealed
// (`reveal`), and a cue's sound prepared (`sound`).
type DrawKind = 'tick' | 'turn' | 'receive' | 'view' | 'reveal' | 'sound'
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
	// Settles once the terminal has taken every write (`run-board-write-port.ts`); none never waits.
	drained?: (() => Promise<void>) | undefined
	// Every write from here on goes to the terminal at once, past any still queued, as the board leaves
	// (joshuafolkken/kit#9027); none writes as before.
	settle?: (() => void) | undefined
	// The theme's restyle of text `write` would put through it; none where no theme draws.
	restyle?: ((text: string) => string) | undefined
	// Wraps an issue number in a hyperlink where the terminal opens one, and leaves it plain elsewhere.
	link: Link
	// Whether stdout is a terminal — only a terminal gets the alternate screen and the spinner.
	is_tty: boolean
	// Whether a live board types each issue row that appears, a letter at a time — only in a theme.
	types_rows?: boolean | undefined
	// Whether the frame is a live board's (or its `--frame` preview's), where a theme's lamp panel and
	// animation area show though its rows do not type (joshuafolkken/kit#8674).
	is_live?: boolean | undefined
	// The theme the frame is drawn in (`run-board-theme.ts`), whose alert display the header adds.
	theme?: Theme | undefined
	// joshuafolkken/kit#8917: the theme host's run a themed live board is drawn by (`run-board-theme-run.ts`)
	// — its frame drawn in the role palette, each row whole, the theme layer typing and animating over
	// it; none on a board in no theme or on a terminal without 24-bit color.
	theme_run?: ThemeRun | undefined
	// joshuafolkken/kit#8939: the redraws asked for between seconds (`run-board-repaint.ts`) — the theme
	// run's own on a themed board; none where nothing asks.
	repaint?: Repaint | undefined
	// The same board in no theme, a themed second's frame drawn through where its theme cannot lay it out
	// — no lamp panel on screen — so it shows the board's own look, never a base half themed.
	plain_ports?: BoardPorts | undefined
	// How the icons are drawn (`run-board-icons.ts`); unset, the theme's default.
	icons?: Icons | undefined
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
	// The repository's pinned issues (`run-board-pinned-graphql.ts`); none where none is read.
	read_pinned?: ((repo: string) => Promise<ReadonlyArray<PinnedIssue> | undefined>) | undefined
	// Sends one chat frame off-screen, for `--every` alone.
	push: (frame: string) => Promise<void>
	// Runs `leave` however the process ends: a normal exit, Ctrl+C or SIGTERM.
	on_exit: (leave: () => void) => void
	sleep: (ms: number) => Promise<void>
	// joshuafolkken/kit#8917: the colors the board's terminal draws, which decide whether a theme run
	// draws it (24-bit) — a replay draws 24-bit color; none reads stdout's (`run-board-paint.ts`).
	color_depth?: (() => number) | undefined
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
	// Takes a spinner wake's due and actual time, for `--timing`'s wake lateness (joshuafolkken/kit#8902);
	// none takes nothing.
	time_wake?: ((due_ms: number, woke_ms: number) => void) | undefined
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
	// The repository's pinned issues — the last read kept while a read fails — the read in flight, and
	// when it was last launched (joshuafolkken/kit#8606).
	pinned: ReadonlyArray<PinnedIssue> | undefined
	pinned_fetch: Fetch<ReadonlyArray<PinnedIssue> | undefined> | undefined
	pinned_attempted_ms: number | undefined
}

// What the frame keeps between redraws: its spinners, typing, sound and notice, and the total it
// counts from.
interface BoardView {
	// The total the first frame counted, which later frames count their progress from.
	baseline_total: number | undefined
	// Where the last frame drew its spinners, turned between redraws.
	spots: ReadonlyArray<Spot>
	// Where the last frame drew its lamp panel's lamps (`run-board-lamp-spots.ts`), the panel a theme
	// draws its area in (`run-board-theme-layout.ts`).
	lamps?: ReadonlyArray<Lamp> | undefined
	// Where the last frame drew its header clocks' colons, blinked between redraws (`run-board-colon.ts`).
	colons?: ReadonlyArray<Spot> | undefined
	// The rows the last frame drew and the ones typing, typed on between redraws (`run-board-type-rows.ts`).
	typing: Typing
	// The rows and run conditions the last frame sounded over, and the standing cue waiting to replay
	// (`run-board-sound-repeat.ts`); none before a run's first frame, so it sounds nothing already there.
	sound_snapshot?: SoundSnapshot | undefined
	sound_pending?: Pending | undefined
	// The last notice picked, kept while the sound is off too (`run-board-header-notice.ts`).
	notice?: Notice | undefined
	// joshuafolkken/kit#8917: the last frame's keyed rows on screen and its alert level
	// (`run-board-header-defcon.ts`), which the theme layer lays out by and shows.
	keyed?: ReadonlyArray<KeyedLine> | undefined
	alert_level?: number | undefined
	// The header's three clocks always dated, for a theme's own time readouts (`run-board-clocks.ts`).
	dated_clocks?: ReadonlyArray<string> | undefined
}

type BoardState = BoardData & BoardView

// The reads a step of `BoardData` takes off GitHub and the disk (`run-board-data.ts`): a live board's
// on its worker thread, a single frame's where it draws.
type DataPorts = Pick<
	BoardPorts,
	| 'read_plan'
	| 'read_closed'
	| 'snapshot'
	| 'read_thanks'
	| 'read_rate_limit'
	| 'read_issue_count'
	| 'read_pinned'
>

// The reads a board folds in on a later step, which hold a promise and so stay on the thread that launched them.
type FetchKey =
	| 'plan_fetch'
	| 'closed_fetch'
	| 'thanks_fetch'
	| 'rate_limit_fetch'
	| 'issue_count_fetch'
	| 'pinned_fetch'

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
	pinned: undefined,
	pinned_fetch: undefined,
	pinned_attempted_ms: undefined,
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

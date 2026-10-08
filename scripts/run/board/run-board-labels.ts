import { styleText } from 'node:util'
import cli_spinners from 'cli-spinners'
import type { Phase } from './run-board-phase'
import type { ItemState } from './run-board-status'

// The words and the clock `run:board` draws with (joshuafolkken/kit#3430), in the session language as
// `run:event --watch`'s labels are. A moment on the board is a local `HH:MM:SS` clock; how long
// something has run is a short `MM:SS` (joshuafolkken/kit#3444), so a person reads the board against
// the clock on their own screen.

const JA = 'ja'
const CLOCK_WIDTH = 2
const CLOCK_PAD = '0'
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR
const MS_PER_MINUTE = MS_PER_SECOND * SECONDS_PER_MINUTE
// Every gauge is this wide — the plan, the machine and a row's phase (joshuafolkken/kit#3450).
const BAR_WIDTH = 10
// A full block done and a thin line left (joshuafolkken/kit#3452): the shapes alone tell the two apart
// where no color is drawn, and a terminal dims the line so the gauge does not read heavy.
const BAR_DONE = '█'
const BAR_LEFT = '─'
const BAR_DONE_COLOR = 'cyan'
const BAR_LEFT_COLOR = 'dim'
// The spinner a running run and a running row turn (joshuafolkken/kit#3452), four frames a second.
const SPINNER_FRAMES = cli_spinners.dots.frames
const SPINNER_FRAME_MS = 250

interface WordPair {
	ja: string
	en: string
}

// One pair per word, as `run-event-render.ts` keeps its labels, so a word cannot be added in one
// language without the other. The board draws most of what it says as a symbol (joshuafolkken/kit#3444);
// the words left are the ones a symbol cannot carry, and the legend that names the symbols.
const WORD_PAIRS = {
	no_run: { ja: 'ランなし', en: 'no run' },
	ended: { ja: '終了', en: 'ended' },
	plan: { ja: '計画', en: 'plan' },
	merged: { ja: 'マージ', en: 'merged' },
	parked: { ja: 'park', en: 'parked' },
	in_progress: { ja: '実行中', en: 'running' },
	waiting: { ja: '待ち', en: 'waiting' },
	decision: { ja: '判断待ち', en: 'decision' },
	waits: { ja: '待ち先', en: 'waits on' },
	dispatched: { ja: '起動', en: 'dispatched' },
	investigate: { ja: '調査', en: 'investigate' },
	implement: { ja: '実装', en: 'implement' },
	review: { ja: 'レビュー', en: 'review' },
	gate: { ja: 'gate', en: 'gate' },
	commit: { ja: 'コミット', en: 'commit' },
	followup: { ja: 'followup', en: 'followup' },
	cpu: { ja: 'cpu', en: 'cpu' },
	memory: { ja: 'mem', en: 'mem' },
	swap: { ja: 'swap', en: 'swap' },
	progress: { ja: '進捗', en: 'progress' },
	idle_until: { ja: '待機終了', en: 'wait ends' },
	idle_left: { ja: '残り', en: 'left' },
	idle_end_idle: {
		ja: '新着がなければ終了してレポート送信',
		en: 'ends and reports unless a new issue arrives',
	},
	idle_end_run: {
		ja: '全体の打ち切りで終了してレポート送信',
		en: 'ends at the whole-run cut-off and reports',
	},
	next_check: { ja: '次の確認', en: 'next check' },
	notes: { ja: '気づき・判断待ち', en: 'findings and decisions' },
	more: { ja: 'ほか', en: 'more' },
	filed: { ja: '起票', en: 'filed' },
	park: { ja: 'park', en: 'park' },
	note: { ja: '意見', en: 'note' },
	found_during: { ja: '（{n} の実装中に発見）', en: ' (found during {n})' },
} as const satisfies Readonly<Record<string, WordPair>>

type Words = Readonly<Record<keyof typeof WORD_PAIRS, string>>

type TextColor = Parameters<typeof styleText>[0]

function words_in(lang: keyof WordPair): Words {
	const entries = Object.entries(WORD_PAIRS).map(([key, pair]) => [key, pair[lang]])

	return Object.fromEntries(entries) as Words
}

const JA_WORDS = words_in('ja')
const EN_WORDS = words_in('en')

// Every row icon is an emoji a terminal draws two columns wide by default (Emoji_Presentation), so the
// number after it lines up whichever state a row is in (joshuafolkken/kit#3444): 🅿 and ☑ are text
// symbols a terminal such as VSCode's draws one column wide, which shifted a parked or finished row.
const STATE_ICONS: Readonly<Record<ItemState, string>> = {
	running: '🔄',
	merged: '✅',
	parked: '💤',
	done: '🏁',
	waiting: '⏳',
	human: '🙋',
}

// The blocking edge, chosen on the same rule: ⛓ is a text symbol.
const WAITS_ICON = '🔗'

// A running row's phase as an icon after its gauge (joshuafolkken/kit#3452), chosen on the same rule,
// so the gauge says how far a child has got and the icon what it is doing now.
const PHASE_ICONS: Readonly<Record<Phase, string>> = {
	dispatched: '🚀',
	investigate: '🔍',
	plan: '📝',
	implement: '🔨',
	review: '👀',
	gate: '🚦',
	commit: '📦',
	followup: '🔁',
	merged: STATE_ICONS.merged,
}

// The legend's word for each phase — the header's own `plan` and `merged` where the phase shares one.
const PHASE_WORDS: Readonly<Record<Phase, keyof Words>> = {
	dispatched: 'dispatched',
	investigate: 'investigate',
	plan: 'plan',
	implement: 'implement',
	review: 'review',
	gate: 'gate',
	commit: 'commit',
	followup: 'followup',
	merged: 'merged',
}

// The header's gauges and marks (joshuafolkken/kit#3450); 📊 rather than 🏁, which is a finished row. ⚡
// rather than 🔥 (joshuafolkken/kit#3452): a fire beside a gauge drawn green read as an alarm.
const HEADER_ICONS = {
	cpu: '⚡',
	memory: '🧠',
	swap: '💾',
	progress: '📊',
	ended: '🔚',
} as const

function words_of(lang: string): Words {
	return lang === JA ? JA_WORDS : EN_WORDS
}

function two_digits(value: number): string {
	return String(value).padStart(CLOCK_WIDTH, CLOCK_PAD)
}

// The local wall-clock `HH:MM:SS` of a moment.
function clock_of(ms: number): string {
	const date = new Date(ms)

	return [date.getHours(), date.getMinutes(), date.getSeconds()]
		.map((value) => two_digits(value))
		.join(':')
}

// A span as `HH:MM:SS`; a negative span — a clock that moved back — reads as zero.
function span_of(ms: number): string {
	const seconds = Math.floor(Math.max(0, ms) / MS_PER_SECOND)
	const hours = Math.floor(seconds / SECONDS_PER_HOUR)
	const minutes = Math.floor(seconds / SECONDS_PER_MINUTE) % MINUTES_PER_HOUR

	return [hours, minutes, seconds % SECONDS_PER_MINUTE].map((value) => two_digits(value)).join(':')
}

// How long something has run, as `MM:SS` whose minutes never carry into hours (`61:05`), so the header
// and every row read one short column; a negative span reads as zero.
function elapsed_of(ms: number): string {
	const seconds = Math.floor(Math.max(0, ms) / MS_PER_SECOND)
	const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)

	return `${two_digits(minutes)}:${two_digits(seconds % SECONDS_PER_MINUTE)}`
}

// How long is left, as `7h38m`; a deadline already passed reads as zero.
function left_of(ms: number): string {
	const minutes = Math.floor(Math.max(0, ms) / MS_PER_MINUTE)
	const hours = Math.floor(minutes / MINUTES_PER_HOUR)

	return `${String(hours)}h${two_digits(minutes % MINUTES_PER_HOUR)}m`
}

// A part of a gauge in its color; an empty part, or no color, draws no escape. `styleText` drops the
// escape itself where stdout draws no color (a pipe, `NO_COLOR`), so a gauge never disagrees with the
// rest of the board about it.
function painted(color: TextColor | undefined, text: string): string {
	return color === undefined || text === '' ? text : styleText(color, text)
}

// **The one progress bar the board draws** — the header's plan, the machine and every running row's
// phase (joshuafolkken/kit#3444): `done` of `total` filled in proportion across `width` cells, the done
// part in `color` (`undefined` leaves it the terminal's own).
function bar_of(
	done: number,
	total: number,
	width: number = BAR_WIDTH,
	color: TextColor | undefined = BAR_DONE_COLOR,
): string {
	const filled = total === 0 ? 0 : Math.round((Math.min(done, total) / total) * width)

	return (
		painted(color, BAR_DONE.repeat(filled)) +
		painted(BAR_LEFT_COLOR, BAR_LEFT.repeat(width - filled))
	)
}

// The spinner's frame at a moment, from the clock rather than a count of redraws, so the frame a redraw
// draws needs no state carried between redraws.
function spinner_of(now_ms: number): string {
	const step = Math.floor(Math.max(0, now_ms) / SPINNER_FRAME_MS)

	return SPINNER_FRAMES[step % SPINNER_FRAMES.length] ?? ''
}

const run_board_labels = {
	HEADER_ICONS,
	PHASE_ICONS,
	PHASE_WORDS,
	SPINNER_FRAME_MS,
	STATE_ICONS,
	WAITS_ICON,
	bar_of,
	clock_of,
	elapsed_of,
	left_of,
	painted,
	span_of,
	spinner_of,
	words_of,
}

export { run_board_labels }
export type { TextColor, Words }

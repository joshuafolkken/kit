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
const BAR_WIDTH = 20
const BAR_DONE = '━'
const BAR_LEFT = '░'

interface WordPair {
	ja: string
	en: string
}

// One pair per word, as `run-event-render.ts` keeps its labels, so a word cannot be added in one
// language without the other. The board draws most of what it says as a symbol (joshuafolkken/kit#3444);
// the words left are the ones a symbol cannot carry, and the legend that names the symbols.
const WORD_PAIRS = {
	no_run: { ja: 'ランなし', en: 'no run' },
	ended_at: { ja: '終了', en: 'ended' },
	plan: { ja: '計画', en: 'plan' },
	merged: { ja: 'マージ', en: 'merged' },
	parked: { ja: 'park', en: 'parked' },
	in_progress: { ja: '実行中', en: 'running' },
	waiting: { ja: '待ち', en: 'waiting' },
	decision: { ja: '判断待ち', en: 'decision' },
	waits: { ja: '待ち先', en: 'waits on' },
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

// **The one progress bar the board draws** — the header's plan and every running row's phase
// (joshuafolkken/kit#3444): `done` of `total` filled in proportion across `width` cells.
function bar_of(done: number, total: number, width: number = BAR_WIDTH): string {
	const filled = total === 0 ? 0 : Math.round((Math.min(done, total) / total) * width)

	return BAR_DONE.repeat(filled) + BAR_LEFT.repeat(width - filled)
}

const run_board_labels = {
	STATE_ICONS,
	WAITS_ICON,
	bar_of,
	clock_of,
	elapsed_of,
	left_of,
	span_of,
	words_of,
}

export { run_board_labels }
export type { Words }

import type { ItemState } from './run-board-status'

// The words and the clock `run:board` draws with (joshuafolkken/kit#3430), in the session language as
// `run:event --watch`'s labels are. Every time on the board is a local `HH:MM:SS` and every span an
// `HH:MM:SS` duration, so a person reads the board against the clock on their own screen.

const JA = 'ja'
const CLOCK_WIDTH = 2
const CLOCK_PAD = '0'
const MS_PER_SECOND = 1000
const SECONDS_PER_MINUTE = 60
const MINUTES_PER_HOUR = 60
const SECONDS_PER_HOUR = SECONDS_PER_MINUTE * MINUTES_PER_HOUR

interface WordPair {
	ja: string
	en: string
}

// One pair per word, as `run-event-render.ts` keeps its labels, so a word cannot be added in one
// language without the other.
const WORD_PAIRS = {
	running: { ja: '▶ 実行中', en: '▶ running' },
	idle: { ja: '⏸ 待機中', en: '⏸ waiting' },
	idle_drained: {
		ja: '⏸ 待機中（全件完了・新着待ち）',
		en: '⏸ waiting (all done, watching for new issues)',
	},
	human: { ja: '✋ 人待ち', en: '✋ waiting on a person' },
	stopped: { ja: '■ 終了', en: '■ ended' },
	no_run: { ja: 'ランなし', en: 'no run' },
	started: { ja: '開始', en: 'started' },
	cutoff: { ja: '打ち切り', en: 'cut-off' },
	ended_at: { ja: '終了', en: 'ended' },
	took: { ja: '所要', en: 'took' },
	last_event: { ja: '最終イベント', en: 'last event' },
	updated: { ja: '更新', en: 'updated' },
	plan: { ja: '計画', en: 'plan' },
	plan_fetched: { ja: '取得', en: 'fetched' },
	plan_none: { ja: '計画 未取得', en: 'plan not fetched yet' },
	plan_failed: { ja: '計画の取得に失敗', en: 'plan fetch failed' },
	progress: { ja: '進捗', en: 'progress' },
	merged: { ja: 'マージ', en: 'merged' },
	parked: { ja: 'park', en: 'parked' },
	in_progress: { ja: '実行中', en: 'running' },
	remaining: { ja: '残り', en: 'left' },
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
	active: { ja: '着手済み', en: 'started' },
	people: { ja: '人待ち', en: 'waiting on a person' },
	unreached: { ja: '未到達', en: 'not reached' },
	waits: { ja: '待ち', en: 'waits on' },
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

const STATE_ICONS: Readonly<Record<ItemState, string>> = {
	running: '🔄',
	merged: '✅',
	parked: '🅿',
	done: '☑',
	waiting: '⏳',
	human: '✋',
}

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

const run_board_labels = { STATE_ICONS, clock_of, span_of, words_of }

export { run_board_labels }
export type { Words }

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

interface Words {
	running: string
	idle: string
	idle_drained: string
	human: string
	stopped: string
	no_run: string
	started: string
	cutoff: string
	last_event: string
	updated: string
	plan: string
	plan_fetched: string
	plan_none: string
	plan_failed: string
	progress: string
	merged: string
	parked: string
	in_progress: string
	remaining: string
	idle_until: string
	idle_left: string
	idle_end_idle: string
	idle_end_run: string
	next_check: string
	active: string
	people: string
	unreached: string
	waits: string
	notes: string
	more: string
	filed: string
	park: string
	note: string
	found_during: string
}

const JA_WORDS: Words = {
	running: '▶ 実行中',
	idle: '⏸ 待機中',
	idle_drained: '⏸ 待機中（全件完了・新着待ち）',
	human: '✋ 人待ち',
	stopped: '■ 終了',
	no_run: 'ランなし',
	started: '開始',
	cutoff: '打ち切り',
	last_event: '最終イベント',
	updated: '更新',
	plan: '計画',
	plan_fetched: '取得',
	plan_none: '計画 未取得',
	plan_failed: '計画の取得に失敗',
	progress: '進捗',
	merged: 'マージ',
	parked: 'park',
	in_progress: '実行中',
	remaining: '残り',
	idle_until: '待機終了',
	idle_left: '残り',
	idle_end_idle: '新着がなければ終了してレポート送信',
	idle_end_run: '全体の打ち切りで終了してレポート送信',
	next_check: '次の確認',
	active: '着手済み',
	people: '人待ち',
	unreached: '未到達',
	waits: '待ち',
	notes: '気づき・判断待ち',
	more: 'ほか',
	filed: '起票',
	park: 'park',
	note: '意見',
	found_during: '（{n} の実装中に発見）',
}

const EN_WORDS: Words = {
	running: '▶ running',
	idle: '⏸ waiting',
	idle_drained: '⏸ waiting (all done, watching for new issues)',
	human: '✋ waiting on a person',
	stopped: '■ ended',
	no_run: 'no run',
	started: 'started',
	cutoff: 'cut-off',
	last_event: 'last event',
	updated: 'updated',
	plan: 'plan',
	plan_fetched: 'fetched',
	plan_none: 'plan not fetched yet',
	plan_failed: 'plan fetch failed',
	progress: 'progress',
	merged: 'merged',
	parked: 'parked',
	in_progress: 'running',
	remaining: 'left',
	idle_until: 'wait ends',
	idle_left: 'left',
	idle_end_idle: 'ends and reports unless a new issue arrives',
	idle_end_run: 'ends at the whole-run cut-off and reports',
	next_check: 'next check',
	active: 'started',
	people: 'waiting on a person',
	unreached: 'not reached',
	waits: 'waits on',
	notes: 'findings and decisions',
	more: 'more',
	filed: 'filed',
	park: 'park',
	note: 'note',
	found_during: ' (found during {n})',
}

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

import type { EventKind, RunEvent } from './run-event-stream'

// One run event as the line a person reads in the watch pane. The pane is a script, not a session, so
// the wording is supplied here — one label per event kind, in the session language, beside the local
// clock time.
//
// **The kinds are a fixed enumeration** (`run-event-stream.ts` → `EVENT_KIND`), so a template table is
// the whole renderer; a kind the table does not name — a stream written by a newer kit — prints its raw
// kind rather than being dropped, so the pane never hides an event.

const JA = 'ja'
const FIELD_SEPARATOR = ' · '
const CLOCK_WIDTH = 2
const CLOCK_PAD = '0'

interface KindLabel {
	ja: string
	en: string
}

// Keyed by `EventKind`, so a kind added to the enumeration without a label fails the type check.
const KIND_LABELS: Readonly<Record<EventKind, KindLabel>> = {
	plan: { ja: '計画', en: 'planned' },
	'child-launch': { ja: '着手', en: 'launched' },
	merge: { ja: 'マージ', en: 'merged' },
	park: { ja: '保留', en: 'parked' },
	split: { ja: '分割', en: 'split' },
	outage: { ja: '障害', en: 'outage' },
	cut: { ja: 'セッション交代', en: 'session cut' },
	resume: { ja: '実装を再開', en: 'implementation resumed' },
	drain: { ja: 'バックログが空', en: 'backlog drained' },
	stop: { ja: '停止', en: 'stopped' },
	'pr-opened': { ja: 'PR 作成', en: 'PR opened' },
	'review-round': { ja: 'レビュー', en: 'review round' },
	retrospective: { ja: '振り返り', en: 'retrospective' },
	stall: { ja: '滞留', en: 'stalled' },
	stranded: { ja: '実行者なし', en: 'stranded' },
	'ship-stage': { ja: '出荷の段階', en: 'ship stage' },
	heartbeat: { ja: '生存確認', en: 'heartbeat' },
	'ship-launch': { ja: '出荷を開始', en: 'ship launched' },
	'ship-stop': { ja: '出荷が停止', en: 'ship stopped' },
	idle: { ja: '新着待ち', en: 'idle watch' },
	filed: { ja: '起票', en: 'filed' },
	note: { ja: '意見', en: 'note' },
	'lane-phase': { ja: 'レーンの段階', en: 'lane phase' },
	add: { ja: '割り込み', en: 'added' },
	'lane-limit': { ja: 'レーン上限', en: 'lane limit' },
}

const LABELS_BY_KIND: ReadonlyMap<string, KindLabel> = new Map(Object.entries(KIND_LABELS))

function label_of(kind: string, lang: string): string {
	const label = LABELS_BY_KIND.get(kind)

	if (label === undefined) return kind

	return lang === JA ? label.ja : label.en
}

function two_digits(value: number): string {
	return String(value).padStart(CLOCK_WIDTH, CLOCK_PAD)
}

// The local wall-clock `HH:MM` of the event, the reading a person watching a pane compares with the clock
// on their screen; an unparseable stamp is shown as written rather than as `NaN:NaN`.
function clock_of(at: string): string {
	const date = new Date(at)

	if (Number.isNaN(date.getTime())) return at

	return `${two_digits(date.getHours())}:${two_digits(date.getMinutes())}`
}

function render(event: RunEvent, lang: string): string {
	return [clock_of(event.at), label_of(event.kind, lang), event.text].join(FIELD_SEPARATOR)
}

const run_event_render = { clock_of, label_of, render }

export type { KindLabel }
export { run_event_render }

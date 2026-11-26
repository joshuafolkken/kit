import { stripVTControlCharacters } from 'node:util'
import { run_board_fit } from './run-board-fit'
import { run_board_theme_host_grid } from './run-board-theme-host-grid'
import { run_board_theme_host_sample, type DemoKey } from './run-board-theme-host-sample'
import { run_board_theme_host_state } from './run-board-theme-host-state'
import type {
	ChannelName,
	EventKey,
	ThemeTimeline,
	TimelineMessage,
} from './run-board-theme-host-types'
import type { TypingLine } from './run-board-type-rows'

// The live board's events on one timeline (joshuafolkken/kit#8917): its NOTICE, PROGRESS and ROW, each
// with the tick it starts on, in the theme host's timeline shape. They come from one place — the rows
// the board types (`run-board-type-rows.ts`): the header notice keyed `notice:`, the now line keyed
// `now:` (a new key whenever its words change, which is the progress line's start) and a lane row keyed
// `lanes:` appearing.
// The rules a real board needs (Issue 4-3): NOTICE > ROW > PROGRESS. A higher event cuts in at once,
// and the one it cut never resumes; the same priority restarts with the new text; a lower one shows its
// text only, never its area effect. A PROGRESS effect starts again no sooner than
// `PROGRESS_THROTTLE_MS` after the last one started — 0, so every progress line plays it.

const { FAR, NOTICE_END, PEAK_TICKS, TICK_MS } = run_board_theme_host_state
const { code_points } = run_board_theme_host_grid
const PRIORITY: Readonly<Record<ChannelName, number>> = { progress: 0, row: 1, notice: 2 }
const EVENT_KEY: Readonly<Record<ChannelName, EventKey>> = { notice: 'n', progress: 'p', row: 'r' }
const SECTION_OF: Readonly<Partial<Record<string, ChannelName>>> = {
	notice: 'notice',
	now: 'progress',
	lanes: 'row',
}
const PROGRESS_THROTTLE_MS = 0
const THROTTLE_TICKS = PROGRESS_THROTTLE_MS / TICK_MS
// The events kept: older ones have long ended.
const MAX_EVENTS = 64
const NO_EVENTS: ReadonlyArray<BoardEvent> = []

// One event: its channel, its first tick, its text, the typed row's key it came from, whether it plays
// its area effect, and the tick a higher event cut it at.
interface BoardEvent {
	name: ChannelName
	start: number
	text: string
	key: string
	has_effect: boolean
	cut?: number | undefined
}

// A theme's whole length in ticks of an event's effect from its start (`ThemeModule.lasts`), in place
// of the host's own.
type Lasts = Readonly<Partial<Record<EventKey, number>>>

function tick_of(ms: number, origin_ms: number): number {
	return Math.floor((ms - origin_ms) / TICK_MS)
}

// The channel a typed row's key feeds; none for a row that is no event.
function name_of(key: string): ChannelName | undefined {
	return SECTION_OF[key.slice(0, key.indexOf(':'))]
}

// How many of `points` fill `columns` as the terminal counts them: a wide character is two.
function points_in(points: ReadonlyArray<string>, columns: number): number {
	let width = 0
	let count = 0

	while (count < points.length && width < columns) {
		width += run_board_fit.width_of(points[count] ?? '')
		count += 1
	}

	return count
}

// The row's words as it types them: its plain text past the columns drawn whole before its key.
function text_of(line: Pick<TypingLine, 'text' | 'prefix_columns'>): string {
	const points = code_points(stripVTControlCharacters(line.text))

	return points.slice(points_in(points, line.prefix_columns)).join('').trimEnd()
}

// The event a newly typing row starts, ticked from `origin_ms`; none for a row that is no event.
function event_of(line: TypingLine, origin_ms: number): BoardEvent | undefined {
	const name = name_of(line.key)

	if (name === undefined) return undefined

	return {
		name,
		start: tick_of(line.start_ms, origin_ms),
		text: text_of(line),
		key: `${line.key}@${String(line.start_ms)}`,
		has_effect: true,
	}
}

// The tick an event's effect ends on: a NOTICE builds to its peak and runs its trace; the others end
// with their typing; a theme's own length for the event (`lasts`) in place of either.
function end_of(event: BoardEvent, lasts: Lasts): number {
	const own = event.name === 'notice' ? PEAK_TICKS + NOTICE_END : code_points(event.text).length

	return event.start + (lasts[EVENT_KEY[event.name]] ?? own)
}

function is_playing(event: BoardEvent, tick: number, lasts: Lasts): boolean {
	if (!event.has_effect || tick < event.start) return false

	return tick < Math.min(end_of(event, lasts), event.cut ?? Infinity)
}

// Whether a PROGRESS comes sooner after the last PROGRESS effect than the throttle allows.
function is_throttled(events: ReadonlyArray<BoardEvent>, event: BoardEvent): boolean {
	if (event.name !== 'progress') return false
	const last = events.findLast((each) => each.name === 'progress' && each.has_effect)

	return last !== undefined && event.start - last.start < THROTTLE_TICKS
}

// `events` with every effect playing that `event` outranks or matches cut at its start.
function cut_by(
	events: ReadonlyArray<BoardEvent>,
	event: BoardEvent,
	lasts: Lasts,
): Array<BoardEvent> {
	return events.map((each) => {
		const is_cut =
			is_playing(each, event.start, lasts) && PRIORITY[each.name] <= PRIORITY[event.name]

		return is_cut ? { ...each, cut: event.start } : each
	})
}

// `events` with `event` added by the rules: under a higher effect playing it shows its text alone.
function added(
	events: ReadonlyArray<BoardEvent>,
	event: BoardEvent,
	lasts: Lasts,
): Array<BoardEvent> {
	const playing = events.filter((each) => is_playing(each, event.start, lasts))
	const is_lower = playing.some((each) => PRIORITY[each.name] > PRIORITY[event.name])
	const has_effect = !is_lower && !is_throttled(events, event)
	const kept = has_effect ? cut_by(events, event, lasts) : [...events]

	return [...kept, { ...event, has_effect }].slice(-MAX_EVENTS)
}

// The events the newly typing `lines` start, added in the order they start; a row seen before adds none.
function observed(
	events: ReadonlyArray<BoardEvent>,
	lines: ReadonlyArray<TypingLine>,
	origin_ms: number,
	lasts: Lasts,
): ReadonlyArray<BoardEvent> {
	const seen = new Set(events.map((event) => event.key))
	const fresh = lines
		.map((line) => event_of(line, origin_ms))
		.filter((event): event is BoardEvent => event !== undefined && !seen.has(event.key))
		.toSorted((first, second) => first.start - second.start)
	let all = events

	for (const event of fresh) all = added(all, event, lasts)

	return all
}

// An event as the host's timeline holds it at `tick`: one with no effect, or cut by then, as typed
// through long before, so its text shows whole and no effect reads it as playing.
function message_at(event: BoardEvent, tick: number): TimelineMessage {
	const is_through = !event.has_effect || (event.cut !== undefined && tick >= event.cut)

	return { start: is_through ? event.start - FAR : event.start, text: event.text }
}

function channel_at(
	events: ReadonlyArray<BoardEvent>,
	name: ChannelName,
	tick: number,
): Array<TimelineMessage> {
	return events
		.filter((event) => event.name === name && event.start <= tick)
		.map((event) => message_at(event, tick))
}

// The timeline the host draws at `tick`, from the events started by then.
function timeline_at(events: ReadonlyArray<BoardEvent>, tick: number): ThemeTimeline {
	return {
		notice: channel_at(events, 'notice', tick),
		progress: channel_at(events, 'progress', tick),
		row: channel_at(events, 'row', tick),
	}
}

// Whether an event's effect plays at `tick`: the theme's own level display shows then.
function is_playing_at(events: ReadonlyArray<BoardEvent>, tick: number, lasts: Lasts): boolean {
	return events.some((event) => is_playing(event, tick, lasts))
}

// The key of the lane row the latest ROW typed, which the layout places the ROW on.
function row_key_of(events: ReadonlyArray<BoardEvent>): string | undefined {
	const key = events.findLast((event) => event.name === 'row')?.key

	return key?.slice(0, key.lastIndexOf('@'))
}

function rebased(messages: ReadonlyArray<TimelineMessage>, shift: number): Array<TimelineMessage> {
	return messages.map(({ start, text, icon }) => ({
		start: start + shift,
		text,
		...(icon !== undefined && { icon }),
	}))
}

// The demo's event `key` (joshuafolkken/kit#8917 demo mode) started on `tick`: its sample texts with
// their icons — the second progress text's `OK`, as the demo shows it — the lane's own row text for a
// ROW, moved so its first message starts on `tick`.
function demo_timeline(key: DemoKey, row_text: string, tick: number): ThemeTimeline {
	const event = run_board_theme_host_sample.demo_events(row_text)[key]
	const starts = [...event.notice, ...event.progress, ...event.row].map(({ start }) => start)
	const shift = tick - (starts.length === 0 ? tick : Math.min(...starts))

	return {
		notice: rebased(event.notice, shift),
		progress: rebased(event.progress, shift),
		row: rebased(event.row, shift),
	}
}

const run_board_theme_events = {
	NO_EVENTS,
	PROGRESS_THROTTLE_MS,
	added,
	demo_timeline,
	end_of,
	event_of,
	is_playing_at,
	observed,
	row_key_of,
	tick_of,
	timeline_at,
}

export { run_board_theme_events }
export type { BoardEvent, Lasts }

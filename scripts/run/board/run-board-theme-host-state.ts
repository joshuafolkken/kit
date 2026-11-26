import type {
	Channel,
	ChannelName,
	Span,
	ThemeLayout,
	ThemeState,
	ThemeTimeline,
	TimelineMessage,
} from './run-board-theme-host-types'

// The theme host's event state (joshuafolkken/kit#8917), ported from the confirmed theme demo: from a
// timeline of notices, progress lines and lanes added, the state of each typed place at a tick.

const TICK_MS = 50
// A place with no message yet: finished this long ago, started this long before.
const FAR = 9999
// A NOTICE's effect builds for four seconds before it peaks, whatever the notice says: the same
// messages, timed by that many ticks in place of their text's length.
const PEAK_TICKS = 80
// Normal display between two plays of an event; its ticks count from NORMAL_FROM.
const GAP_TICKS = 40
const NORMAL_FROM = 5000
// The board's pace everywhere: a letter a tick.
const ROW_PACE = 1
// A PROGRESS or ROW effect returns to the board at its own ending: no extra linger.
const LINGER = 0
// The notice's trace: an inverse bar lies over the text for a second, three times, a second apart,
// from the peak; the NOTICE's whole effect outlasts the third bar by a second.
const TRACE_ON = 20
const TRACE_EVERY = 40
const TRACE_END = TRACE_EVERY + TRACE_EVERY + TRACE_ON
const NOTICE_TAIL = 20
const NOTICE_END = TRACE_END + NOTICE_TAIL

interface Timing {
	span: Span
	tick: number
	pace?: number
}

function total_of(text: string, span: Span): number {
	return Math.min(span.end - span.x - 1, text.length)
}

function message_total(message: TimelineMessage, span: Span): number {
	return message.ticks ?? total_of(message.text, span)
}

function unstarted(name: ChannelName, span: Span): Channel {
	const index = -1

	return {
		name,
		index,
		is_typing: false,
		length: 0,
		total: 0,
		cooled: FAR,
		start: -FAR,
		span,
		text: '',
		icon: undefined,
	}
}

// One place's typed state: which message, how much of it shows, and the ticks since it finished
// (0 on the tick the last letter lands, counting up from there).
function channel(name: ChannelName, messages: Array<TimelineMessage>, timing: Timing): Channel {
	const { span, tick, pace = 1 } = timing
	const index = messages.findLastIndex(({ start }) => tick >= start)
	const message = messages[index]

	if (!message) return unstarted(name, span)
	const { start, icon } = message
	const total = message_total(message, span)
	const length = Math.min(total, (tick - start + 1) * pace)
	const is_typing = length < total
	const cooled = is_typing ? 0 : tick - start - Math.ceil(total / pace) + 1

	return {
		name,
		index,
		is_typing,
		length,
		total,
		cooled,
		start,
		span,
		text: message.text.slice(0, total),
		icon,
	}
}

function typing_ticks(message: TimelineMessage, span: Span, pace: number): number {
	return Math.ceil(message_total(message, span) / pace)
}

// The ticks the messages have spent typing by `tick`.
function typed_ticks(messages: Array<TimelineMessage>, span: Span, tick: number, pace = 1): number {
	let sum = 0

	for (const message of messages) {
		sum += Math.max(0, Math.min(tick - message.start + 1, typing_ticks(message, span, pace)))
	}

	return sum
}

function held(messages: Array<TimelineMessage>): Array<TimelineMessage> {
	return messages.map((message) => ({ ...message, ticks: PEAK_TICKS }))
}

function ticks_of(layout: ThemeLayout, timeline: ThemeTimeline, tick: number): number {
	const notice = typed_ticks(held(timeline.notice), layout.notice, tick)

	return (
		notice +
		typed_ticks(timeline.progress, layout.progress, tick) +
		typed_ticks(timeline.row, layout.row, tick, ROW_PACE)
	)
}

// How many of a channel's messages have finished typing.
function finished(typed: Channel): number {
	if (typed.index < 0) return 0

	return typed.index + (typed.is_typing ? 0 : 1)
}

// An event's effect plays while its text types and for `tail` ticks after.
function active(typed: Channel, tail: number): boolean {
	return typed.index >= 0 && (typed.is_typing || typed.cooled < tail)
}

type Summary = Pick<ThemeState, 'done' | 'last_start' | 'latest' | 'since'>

function summary_of(all: Array<Channel>, is_busy: boolean): Summary {
	const ended = all
		.filter((each) => each.index >= 0 && !each.is_typing)
		.toSorted((first, second) => first.cooled - second.cooled)
	let done = 0

	for (const each of all) done += finished(each)

	return {
		latest: ended[0]?.name,
		since: is_busy ? 0 : Math.min(...all.map((each) => each.cooled)),
		last_start: Math.max(...all.map((each) => each.start)),
		done,
	}
}

// Everything an effect reads at `tick`. `notice` times the NOTICE's effect (a fixed length);
// `notice_text` is the notice's text as it types.
function state_of(layout: ThemeLayout, timeline: ThemeTimeline, tick: number): ThemeState {
	const notice = channel('notice', held(timeline.notice), { span: layout.notice, tick })
	const notice_text = channel('notice', timeline.notice, { span: layout.notice, tick })
	const progress = channel('progress', timeline.progress, { span: layout.progress, tick })
	const row = channel('row', timeline.row, { span: layout.row, tick, pace: ROW_PACE })
	const all = [notice, progress, row]
	const is_busy = all.some((each) => each.is_typing)
	const event = { ...timeline, total: ticks_of(layout, timeline, FAR) }
	const busy_ticks = ticks_of(layout, timeline, tick)

	return {
		tick,
		event,
		notice,
		notice_text,
		progress,
		row,
		all,
		busy: is_busy,
		busy_ticks,
		...summary_of(all, is_busy),
	}
}

const run_board_theme_host_state = {
	FAR,
	GAP_TICKS,
	LINGER,
	NOTICE_END,
	NORMAL_FROM,
	PEAK_TICKS,
	TICK_MS,
	TRACE_END,
	TRACE_EVERY,
	TRACE_ON,
	active,
	channel,
	finished,
	held,
	state_of,
	ticks_of,
	total_of,
	typed_ticks,
}

export { run_board_theme_host_state }

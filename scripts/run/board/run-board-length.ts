import { figure_format } from '#scripts/lib/figure-format'
import { MS_PER_MINUTE, MS_PER_SECOND, SECONDS_PER_MINUTE } from '#scripts/lib/timeouts'

// Every length `run:board` draws — how long the run, a row, a phase or the heartbeat has run — in
// degree-minute-second style (`1°15′57″`), so a length never shares the clock's `:`. Re-exported by
// `run-board-labels.ts`, where the board's words and clock are read from.

const MINUTES_PER_HOUR = 60
// A length's units — hours, minutes and seconds — so a length never shares the clock's `:`.
const SPAN_UNITS = { hours: '°', minutes: '′', seconds: '″' } as const
// The seconds a length rounded to its minute draws, which `minute_span_of` leaves off.
const ZERO_SECONDS = `00${SPAN_UNITS.seconds}`

const { two_digits } = figure_format

// A length as its hours, and its minutes and seconds within the hour, each its count with the mark it
// is drawn with; a negative span reads as zero.
function span_fields(ms: number): Array<{ value: number; unit: string }> {
	const seconds = Math.floor(Math.max(0, ms) / MS_PER_SECOND)
	const minutes = Math.floor(seconds / SECONDS_PER_MINUTE)
	const hours = Math.floor(minutes / MINUTES_PER_HOUR)

	return [
		{ value: hours, unit: SPAN_UNITS.hours },
		{ value: minutes % MINUTES_PER_HOUR, unit: SPAN_UNITS.minutes },
		{ value: seconds % SECONDS_PER_MINUTE, unit: SPAN_UNITS.seconds },
	]
}

// **Every length the board draws**, in degree-minute-second style (`26″`, `3′27″`, `1°15′57″`): the
// leading unit not padded and a zero one dropped down to the seconds, the units after it two digits;
// a negative span reads as zero.
function span_of(ms: number): string {
	const fields = span_fields(ms)
	const lead = fields.findIndex((field, index) => field.value > 0 || index === fields.length - 1)
	const [first, ...rest] = fields.slice(lead)
	const head = first === undefined ? '' : `${String(first.value)}${first.unit}`

	return head + rest.map((field) => `${two_digits(field.value)}${field.unit}`).join('')
}

// A length rounded up to its minute, in `span_of`'s style without the seconds (`25′`, `1°05′`), never
// under a minute: an estimate drawn to the second would claim a precision it does not have.
function minute_span_of(ms: number): string {
	const minutes = Math.max(1, Math.ceil(ms / MS_PER_MINUTE))

	return span_of(minutes * MS_PER_MINUTE).slice(0, -ZERO_SECONDS.length)
}

const run_board_length = { minute_span_of, span_of }

export { run_board_length }

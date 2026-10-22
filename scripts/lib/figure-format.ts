import { MS_PER_MINUTE } from '#scripts/lib/timeouts'

// The figures the reports print — a dollar amount, a token count, a percentage share, a duration in
// minutes and a local wall clock — and the precision each uses. The cost reports, `josh time`'s
// reports, `run:board` and the run event pane all render these, so each is written once here.

const USD_DECIMALS = 4
const PERCENT_SCALE = 100
const PERCENT_DECIMALS = 1
const MINUTE_DECIMALS = 1
const CLOCK_WIDTH = 2
const CLOCK_PAD = '0'

// The caller names the decimals where its figure rounds to another place — a run total to the cent.
function format_usd(usd: number, decimals: number = USD_DECIMALS): string {
	return `$${usd.toFixed(decimals)}`
}

function format_tokens(count: number): string {
	return count.toLocaleString('en-US')
}

function format_share(part: number, whole: number): string {
	if (whole === 0) return 'n/a'

	return `${((part / whole) * PERCENT_SCALE).toFixed(PERCENT_DECIMALS)}%`
}

function format_minutes(duration_ms: number): string {
	return `${(duration_ms / MS_PER_MINUTE).toFixed(MINUTE_DECIMALS)} min`
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

// The local wall-clock `HH:MM` of a moment, for one a person reads to the minute.
function minute_of(ms: number): string {
	const date = new Date(ms)

	return [date.getHours(), date.getMinutes()].map((value) => two_digits(value)).join(':')
}

const figure_format = {
	format_usd,
	format_tokens,
	format_share,
	format_minutes,
	two_digits,
	clock_of,
	minute_of,
}

export { figure_format }

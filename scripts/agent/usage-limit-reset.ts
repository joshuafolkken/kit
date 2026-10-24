// When a Claude usage limit resets, read off the harness's own limit sentence (joshuafolkken/kit#4745):
// `resets 10am (Asia/Tokyo)`, `resets 3:30pm (America/New_York)`, `resets Oct 25, 10am (Asia/Tokyo)`, or
// the older `Claude AI usage limit reached|<epoch seconds>`. The wall clock is turned into an instant in
// its named zone with the platform's `Intl`, so no time-zone table is kept here. A sentence that names
// no readable time, or an unknown zone, answers `undefined` — the caller re-checks on an interval.

const RESET_PATTERN = /resets (?<when>[^(]*)\((?<zone>[^)]*)\)/iu
const TIME_PATTERN = /\b(?<hour>\d{1,2})(?::(?<minute>\d{2}))? ?(?<meridiem>am|pm)\b/iu
const DATE_PATTERN = /\b(?<month>[a-z]+)\.? (?<day>\d{1,2})\b/iu
const MONTH_PREFIX = 3
const EPOCH_PATTERN = /\|(?<epoch>\d{10})\b/u
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MS_PER_SECOND = 1000
const MS_PER_MINUTE = 60_000
const HALF_YEAR_MS = 15_778_800_000
const HOURS_PER_HALF_DAY = 12
const PM = 'pm'
const NOT_FOUND = -1

interface ZoneFields {
	year: number
	month: number
	day: number
	hour: number
	minute: number
}

interface WallClock {
	// The named date, where the sentence carries one — a weekly limit's reset can be days away.
	date: Pick<ZoneFields, 'month' | 'day'> | undefined
	hour: number
	minute: number
	zone: string
}

type Groups = Readonly<Record<string, string | undefined>>

function epoch_ms(text: string): number | undefined {
	const epoch = EPOCH_PATTERN.exec(text)?.groups?.['epoch']

	return epoch === undefined ? undefined : Number(epoch) * MS_PER_SECOND
}

// A word that is no month's name — `resets at 10am` — names no date.
function dated(groups: Groups): WallClock['date'] {
	const month = MONTHS.indexOf(String(groups['month']).slice(0, MONTH_PREFIX).toLowerCase())

	return month === NOT_FOUND ? undefined : { month, day: Number(groups['day']) }
}

function date_of(when: string): WallClock['date'] {
	const groups = DATE_PATTERN.exec(when)?.groups

	return groups === undefined ? undefined : dated(groups)
}

function hour_of(time: Groups): number {
	const half = time['meridiem']?.toLowerCase() === PM ? HOURS_PER_HALF_DAY : 0

	return (Number(time['hour']) % HOURS_PER_HALF_DAY) + half
}

function wall_of(when: string, zone: string): WallClock | undefined {
	const time = TIME_PATTERN.exec(when)?.groups

	if (time === undefined) return undefined

	return { date: date_of(when), hour: hour_of(time), minute: Number(time['minute'] ?? 0), zone }
}

function zone_format(zone: string): Intl.DateTimeFormat {
	return new Intl.DateTimeFormat('en-US', {
		timeZone: zone,
		hourCycle: 'h23',
		year: 'numeric',
		month: 'numeric',
		day: 'numeric',
		hour: 'numeric',
		minute: 'numeric',
	})
}

// The wall clock the zone reads at an instant. Throws `RangeError` on a zone `Intl` does not know.
function zone_fields(at_ms: number, zone: string): ZoneFields {
	const parts = zone_format(zone).formatToParts(at_ms)
	const read = new Map(parts.map((part) => [part.type, Number(part.value)]))

	function field(type: Intl.DateTimeFormatPartTypes): number {
		return read.get(type) ?? 0
	}

	return {
		year: field('year'),
		month: field('month') - 1,
		day: field('day'),
		hour: field('hour'),
		minute: field('minute'),
	}
}

function utc_of(fields: ZoneFields): number {
	return Date.UTC(fields.year, fields.month, fields.day, fields.hour, fields.minute)
}

// How far the zone's wall clock runs ahead of UTC at an instant, to the minute.
function offset_ms(at_ms: number, zone: string): number {
	return utc_of(zone_fields(at_ms, zone)) - (at_ms - (at_ms % MS_PER_MINUTE))
}

// The instant the zone's wall clock reads `fields`, the offset read again at the first guess so a
// daylight-saving change between the two is followed.
function instant_of(fields: ZoneFields, zone: string): number {
	const guess = utc_of(fields)

	return guess - offset_ms(guess - offset_ms(guess, zone), zone)
}

// The years to move a named date in this year by so it lies within half a year of `now_ms`: a January
// date read in December is next year's, a December date read in January last year's.
function year_shift(at_ms: number, now_ms: number): number {
	if (now_ms - at_ms > HALF_YEAR_MS) return 1

	return at_ms - now_ms > HALF_YEAR_MS ? -1 : 0
}

// A named date's nearest occurrence. One just past stays past, for the caller's re-check.
function dated_instant(fields: ZoneFields, zone: string, now_ms: number): number {
	const at_ms = instant_of(fields, zone)
	const shift = year_shift(at_ms, now_ms)

	return shift === 0 ? at_ms : instant_of({ ...fields, year: fields.year + shift }, zone)
}

// An undated hour's next occurrence: today's, else the next day's.
function undated_instant(fields: ZoneFields, zone: string, now_ms: number): number {
	const at_ms = instant_of(fields, zone)

	return at_ms > now_ms ? at_ms : instant_of({ ...fields, day: fields.day + 1 }, zone)
}

function next_instant(wall: WallClock, now_ms: number): number {
	const today = zone_fields(now_ms, wall.zone)
	const fields = { ...today, ...wall.date, hour: wall.hour, minute: wall.minute }

	if (wall.date === undefined) return undated_instant(fields, wall.zone, now_ms)

	return dated_instant(fields, wall.zone, now_ms)
}

function wall_in(text: string): WallClock | undefined {
	const groups = RESET_PATTERN.exec(text)?.groups

	if (groups === undefined) return undefined

	return wall_of(String(groups['when']), String(groups['zone']).trim())
}

// A zone `Intl` does not know reads as no time.
function known_instant(wall: WallClock, now_ms: number): number | undefined {
	try {
		return next_instant(wall, now_ms)
	} catch {
		return undefined
	}
}

function clock_ms(text: string, now_ms: number): number | undefined {
	const wall = wall_in(text)

	return wall === undefined ? undefined : known_instant(wall, now_ms)
}

function reset_ms(text: string, now_ms: number): number | undefined {
	return epoch_ms(text) ?? clock_ms(text, now_ms)
}

const usage_limit_reset = { reset_ms }

export { usage_limit_reset }

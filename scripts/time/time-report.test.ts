import { describe, expect, it } from 'vitest'
import { time_report } from './time-report'
import { time_spans, type Span, type Timeline } from './time-spans'

const MINUTE_MS = 60_000
const SESSION = 'abcd1234'
const PNPM_LABEL = 'Bash: pnpm'

function span(category: Span['category'], minutes: number, label = '', josh_command = ''): Span {
	return { category, label, josh_command, duration_ms: minutes * MINUTE_MS }
}

function timeline(spans: ReadonlyArray<Span>): Timeline {
	const elapsed = spans.reduce((sum, entry) => sum + entry.duration_ms, 0)

	return { started_ms: MINUTE_MS, ended_ms: MINUTE_MS + elapsed, spans: [...spans] }
}

function build(spans: ReadonlyArray<Span>): ReturnType<typeof time_report.build_report> {
	return time_report.build_report(SESSION, timeline(spans))
}

const MIXED = [
	span(time_spans.MODEL_CATEGORY, 4),
	span(time_spans.TOOL_CATEGORY, 3, PNPM_LABEL, 'josh gate'),
	span(time_spans.TOOL_CATEGORY, 2, 'Read'),
	span(time_spans.TOOL_CATEGORY, 1, PNPM_LABEL, 'josh lint'),
	span(time_spans.HUMAN_CATEGORY, 10),
]

describe('time_report.build_report — categories', () => {
	it('totals each of the three categories', () => {
		expect(build(MIXED).categories).toEqual({
			model_ms: 4 * MINUTE_MS,
			tool_ms: 6 * MINUTE_MS,
			human_ms: 10 * MINUTE_MS,
		})
	})

	it('reports the elapsed time the timeline spans', () => {
		expect(build(MIXED).elapsed_ms).toBe(20 * MINUTE_MS)
	})

	it('dates the session from its first and last event', () => {
		const report = build(MIXED)

		expect(report.started_at).toBe(new Date(MINUTE_MS).toISOString())
		expect(report.ended_at).toBe(new Date(21 * MINUTE_MS).toISOString())
	})
})

describe('time_report.build_report — per-label totals', () => {
	it('bundles repeated calls of one label and counts them', () => {
		expect(build(MIXED).by_tool).toEqual([
			{ label: PNPM_LABEL, duration_ms: 4 * MINUTE_MS, call_count: 2 },
			{ label: 'Read', duration_ms: 2 * MINUTE_MS, call_count: 1 },
		])
	})

	// Descending by time, not by name: the row a reader is looking for is the expensive one.
	it('orders the rows by time spent, descending', () => {
		const rows = build([
			span(time_spans.TOOL_CATEGORY, 1, 'Aaa'),
			span(time_spans.TOOL_CATEGORY, 9, 'Zzz'),
		]).by_tool

		expect(rows.map((row) => row.label)).toEqual(['Zzz', 'Aaa'])
	})

	it('splits the josh subcommands apart from the tool that ran them', () => {
		expect(build(MIXED).by_josh_command).toEqual([
			{ label: 'josh gate', duration_ms: 3 * MINUTE_MS, call_count: 1 },
			{ label: 'josh lint', duration_ms: MINUTE_MS, call_count: 1 },
		])
	})

	// Every span carries a category but only tool spans carry a label, so an empty label is not a
	// bucket — printed as one it would report a total nobody measured.
	it('never opens a bucket for an unlabelled span', () => {
		const report = build([span(time_spans.MODEL_CATEGORY, 4)])

		expect(report.by_tool).toEqual([])
		expect(report.by_josh_command).toEqual([])
	})
})

describe('time_report.format_report', () => {
	it('prints the three categories with their share of the elapsed time', () => {
		const text = time_report.format_report(build(MIXED))

		expect(text).toContain('model wait')
		expect(text).toContain('20.0%')
		expect(text).toContain('50.0%')
	})

	it('prints the two tables under their own headings', () => {
		const text = time_report.format_report(build(MIXED))

		expect(text).toContain('By tool (descending):')
		expect(text).toContain('By josh command (descending):')
	})

	// A long run touches thirty-odd distinct leading commands. The cap keeps the table readable and
	// says how many rows it withheld, because a silently truncated table is read as a complete one.
	it('caps the rows and says how many it withheld', () => {
		const many = Array.from({ length: time_report.MAX_ROWS + 3 }, (_, index) =>
			span(time_spans.TOOL_CATEGORY, index + 1, `tool-${String(index)}`),
		)

		expect(time_report.format_report(build(many))).toContain('… and 3 more')
	})

	// A table of zeroes reads as "this run took no time", which is never true.
	it('says a transcript has no timed lines instead of printing zeroes', () => {
		const text = time_report.format_report(build([]))

		expect(text).toContain('no timed lines')
		expect(text).not.toContain('Where the wall clock went')
	})
})

describe('time_report.format_share', () => {
	it('answers n/a rather than dividing by an elapsed time of zero', () => {
		expect(time_report.format_share(0, 0)).toBe('n/a')
	})
})

describe('time_report.format_minutes', () => {
	it('prints milliseconds as minutes to one decimal', () => {
		expect(time_report.format_minutes(90 * 1000)).toBe('1.5 min')
	})
})

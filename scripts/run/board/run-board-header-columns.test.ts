import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import type { BoardLayout, BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#3692: the header's two lines stand in columns. The run's `⏰` and the `💓` under
// it start in one column and end their digits in one, whatever stands before them — a repository's
// name shorter or longer than the run's, or none — and the progress bar and the first machine gauge
// start in one column whatever the count and the percent before them are. A column is counted as the
// terminal draws it, an emoji two wide, never as a count of characters.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header, lines_of } = run_board_render_fixture
const SECOND = 1000
const HOUR = 60 * MINUTE
const KIT = 'joshuafolkken/kit'
const LONG = 'joshuafolkken/a-long-repository'
const BAR_CELL = /[■─]/u
// A run and its silence a second either side of ten hours, so one time has a digit the other lacks.
const UNEVEN_SPANS = [
	{
		shorter: '💓',
		ran: 10 * HOUR,
		silent: 10 * HOUR - SECOND,
		elapsed: '⏰ 10:00:00',
		beat: '💓  9:59:59',
	},
	{
		shorter: '⏰',
		ran: 10 * HOUR - SECOND,
		silent: 10 * HOUR,
		elapsed: '⏰  9:59:59',
		beat: '💓 10:00:00',
	},
]
const BEATING = { last_event_ms: NOW - MINUTE, is_stopped: false }

function row(number: number, state: BoardRow['state']): BoardRow {
	return { number, title: undefined, kind: undefined, state, status: undefined, waits: [] }
}

function machine(cpu_percent: number): NonNullable<BoardHeader['machine']> {
	return { cpu_percent, memory_percent: 37, swap_mb_per_s: 3.1, memory_pressure: undefined }
}

// A plan with `settled` of its `total` rows merged and the rest waiting.
function plan(settled: number, total: number): BoardLayout {
	const merged = Array.from({ length: settled }, (_, index) => row(index + 1, 'merged'))
	const waiting = Array.from({ length: total - settled }, (_, index) => row(100 + index, 'waiting'))

	return { ...EMPTY_LAYOUT, active: merged, unreached: waiting }
}

function header_of(extra: Partial<BoardHeader>): Array<string> {
	return lines_of(header({ activity: BEATING, ...extra })).slice(0, 2)
}

// The column `text` starts in on `line`.
function start_of(line: string | undefined, text: string): number {
	const drawn = line ?? ''

	expect(drawn).toContain(text)

	return run_board_fit.width_of(drawn.slice(0, drawn.indexOf(text)))
}

// The column the time after `icon` ends in on `line`.
function time_end_of(line: string | undefined, icon: string): number {
	const [drawn = ''] = new RegExp(String.raw`^.*${icon} +[\d:]+`, 'u').exec(line ?? '') ?? []

	expect(drawn).not.toBe('')

	return run_board_fit.width_of(drawn)
}

// The column the bar after `icon` starts in on `line`.
function bar_start_of(line: string | undefined, icon: string): number {
	const drawn = line ?? ''
	const from = drawn.indexOf(icon)
	const bar = drawn.slice(from).search(BAR_CELL)

	expect(from).toBeGreaterThanOrEqual(0)
	expect(bar).toBeGreaterThan(0)

	return run_board_fit.width_of(drawn.slice(0, from + bar))
}

describe('run_board_header.header_lines — the time column', () => {
	it('draws the run’s age after its name and the 💓 under it, in one column', () => {
		const [first, second] = header_of({ repo: KIT })

		expect(first).toMatch(/^⏸ backlogrun {2}⏰ 2:10:00 {2}✅/u)
		expect(second).toMatch(/^ {2}kit {9}💓 0:01:00 {2}⚡/u)
		expect(start_of(second, '💓')).toBe(start_of(first, '⏰'))
	})

	it.each(UNEVEN_SPANS)('ends the digits in one column where the $shorter is shorter', (spans) => {
		const activity = { last_event_ms: NOW - spans.silent, is_stopped: false }
		const [first, second] = header_of({ started_ms: NOW - spans.ran, activity })

		expect(first).toContain(`  ${spans.elapsed}  `)
		expect(second).toContain(`  ${spans.beat}  `)
		expect(time_end_of(second, '💓')).toBe(time_end_of(first, '⏰'))
	})
})

describe('run_board_header.header_lines — the time column once the run has ended', () => {
	it('draws 🔚 under the ⏰ in the 💓’s place, the header still two lines', () => {
		const ended_ms = STARTED + 90 * MINUTE
		const activity = { last_event_ms: ended_ms, is_stopped: true }
		const lines = lines_of(header({ activity, ended_ms, repo: KIT }))

		expect(lines[0]).toMatch(/^■ backlogrun {2}⏰ 1:30:00 {2}✅/u)
		expect(lines[1]).toMatch(/^ {2}kit {9}🔚 \d{2}:\d{2} {4}\S/u)
		expect(lines[2]).toBe('')
		expect(lines.join('\n')).not.toContain('💓')
	})

	it('starts an ended run’s progress bar and its first machine gauge in one column', () => {
		const ended_ms = STARTED + 90 * MINUTE
		const activity = { last_event_ms: ended_ms, is_stopped: true }
		const lines = lines_of(header({ activity, ended_ms, repo: KIT, machine: machine(9) }))

		expect(bar_start_of(lines[1], '⚡')).toBe(bar_start_of(lines[0], '✅'))
	})
})

describe('run_board_header.header_lines — the name column', () => {
	it.each([
		['shorter than the run’s', KIT, /^ {2}kit {9}💓/u],
		['longer than the run’s', LONG, /^ {2}a-long-repository {2}💓/u],
		['not read yet', undefined, /^ {14}💓/u],
	])('keeps the times in one column with a repository name %s', (_case, repo, drawn) => {
		const [first, second] = header_of({ repo })

		expect(second).toMatch(drawn)
		expect(start_of(second, '💓')).toBe(start_of(first, '⏰'))
		expect(time_end_of(second, '💓')).toBe(time_end_of(first, '⏰'))
	})

	it('widens the first line’s name to a longer repository name', () => {
		const [first] = header_of({ repo: LONG })

		expect(first).toMatch(/^⏸ backlogrun {9}⏰ /u)
	})

	it('starts the repository name under the run’s past a two-column mark', () => {
		const layout = { ...EMPTY_LAYOUT, people: [row(2, 'human')] }
		const [first, second] = header_of({ layout, repo: KIT })

		expect(start_of(second, 'kit')).toBe(start_of(first, 'backlogrun'))
		expect(start_of(second, '💓')).toBe(start_of(first, '⏰'))
	})
})

describe('run_board_header.header_lines — the gauge column', () => {
	it.each([
		[1, 2, 9],
		[1, 2, 100],
		[10, 12, 9],
		[10, 12, 100],
		[100, 120, 100],
	])('starts both bars in one column at %i/%i over %i%%', (settled, total, cpu) => {
		const [first, second] = header_of({ layout: plan(settled, total), machine: machine(cpu) })

		expect(first).toContain(`${String(settled)}/${String(total)} `)
		expect(second).toContain(`${String(cpu)}% `)
		expect(bar_start_of(second, '⚡')).toBe(bar_start_of(first, '✅'))
	})

	it('keeps the progress bar where it is as the count and the percent gain a digit', () => {
		const starts = [9, 100].flatMap((cpu) =>
			[1, 2].map((settled) => {
				const [first] = header_of({ layout: plan(settled, 2), machine: machine(cpu) })

				return bar_start_of(first, '✅')
			}),
		)

		expect(new Set(starts).size).toBe(1)
	})
})

// A chat draws the memory alone, and a board before its first sample no gauge at all: the times
// stand where a screen's do, and what is drawn of the machine starts under the progress.
describe('run_board_header.header_lines — with marks left out', () => {
	it('keeps the times of a chat where a screen draws them, the 🧠 bar under the progress bar', () => {
		const screen = header_of({ machine: machine(11), repo: KIT })
		const chat = header_of({ machine: machine(11), repo: KIT, form: 'chat' })

		expect(chat[1]).not.toContain('⚡')
		expect(start_of(chat[1], '💓')).toBe(start_of(screen[1], '💓'))
		expect(time_end_of(chat[1], '💓')).toBe(time_end_of(chat[0], '⏰'))
		expect(bar_start_of(chat[1], '🧠')).toBe(bar_start_of(chat[0], '✅'))
	})

	// A tally wider than a percent: the 🧠's own width no longer reaches the progress bar's column.
	it.each([
		[10, 12],
		[100, 120],
	])('starts the 🧠 bar of a chat under the progress bar at %i/%i', (settled, total) => {
		const layout = plan(settled, total)
		const [first, second] = header_of({ layout, machine: machine(11), form: 'chat' })

		expect(second).not.toContain('⚡')
		expect(bar_start_of(second, '🧠')).toBe(bar_start_of(first, '✅'))
	})

	it('keeps the machine in its column with no heartbeat and no machine read', () => {
		const activity = { last_event_ms: undefined, is_stopped: false }
		const [first, second] = header_of({ activity })

		expect(second).not.toContain('💓')
		expect(start_of(second, '⚡')).toBe(start_of(first, '✅'))
	})
})

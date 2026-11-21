import { describe, expect, it } from 'vitest'
import { run_board_fit } from './run-board-fit'
import type { BoardHeader } from './run-board-header'
import type { BoardLayout, BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#3692: the header's lines stand in columns. The run's `⏰`, the cell under it and
// the third line's spinner start in one column, whatever stands before them — a repository's name
// shorter or longer than the run's, or none — and the first machine gauge starts in one column whatever
// the count and the percent are (joshuafolkken/kit#8514). A column is counted as the terminal
// draws it, an emoji two wide, never as a count of characters. A running run leaves the cell under the
// `⏰` blank: its heartbeat is said in the notice slot (joshuafolkken/kit#8475).

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, header, lines_of } = run_board_render_fixture
const KIT = 'joshuafolkken/kit'
const LONG = 'joshuafolkken/a-long-repository'
const BAR_CELL = /[■─]/u
const BEATING = { last_event_ms: NOW - MINUTE, is_stopped: false }
const BOARD_NAME = 'josh-board'
const VERSION = 'v1.3153.0'
const WIDE_VERSION = 'v1.3153.0+12'
const SINGLE_NAME = 'fullrun'
const SPINNER = '⠙'

// A link drawn as markdown, so the test reads which text links where.
function markdown_link(text: string, url: string): string {
	return `[${text}](${url})`
}

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

// All three lines of a run with a child running and the spinner turning, so the third line draws its
// time beside the repository.
function moving_of(extra: Partial<BoardHeader>): Array<string> {
	const layout = { ...EMPTY_LAYOUT, active: [row(1, 'running')] }

	return lines_of(header({ activity: BEATING, layout, spinner: SPINNER, ...extra })).slice(0, 3)
}

// The column `text` starts in on `line`.
function start_of(line: string | undefined, text: string): number {
	const drawn = line ?? ''

	expect(drawn).toContain(text)

	return run_board_fit.width_of(drawn.slice(0, drawn.indexOf(text)))
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
	it('draws the run’s age after its name and leaves the cell under it blank while it runs', () => {
		const [first, second] = header_of({ repo: KIT })

		expect(first).toBe('⏸ josh-board  ⏰ 2°10′00″')
		expect(second).toMatch(/^ {2}- +💪/u)
		expect(second).not.toContain('💓')
	})
})

describe('run_board_header.header_lines — the time column once the run has ended', () => {
	it('draws 🔚 under the ⏰ in the 💓’s place, the repository alone under them', () => {
		const ended_ms = STARTED + 90 * MINUTE
		const activity = { last_event_ms: ended_ms, is_stopped: true }
		const lines = lines_of(header({ activity, ended_ms, repo: KIT }))

		expect(lines[0]).toBe('■ josh-board  ⏰ 1°30′00″')
		expect(lines[1]).toMatch(/^ {2}- {11}🔚 \d{2}:\d{2} {5}\S/u)
		expect(lines[2]).toBe('  kit')
		expect(lines.join('\n')).not.toContain('💓')
	})
})

describe('run_board_header.header_lines — the name column', () => {
	it.each([
		['shorter than the board’s', KIT, /^ {2}kit {9}⠙ /u],
		['longer than the board’s', LONG, /^ {2}a-long-repository {2}⠙ /u],
		['not read yet', undefined, /^ {14}⠙ /u],
	])('keeps the times in one column with a repository name %s', (_case, repo, now) => {
		const [first, , third] = moving_of({ repo })

		expect(third).toMatch(now)
		expect(start_of(third, SPINNER)).toBe(start_of(first, '⏰'))
	})

	it('widens the first line’s name to a longer repository name', () => {
		const [first] = header_of({ repo: LONG })

		expect(first).toMatch(/^⏸ josh-board {9}⏰ /u)
	})

	it('starts the version and the repository under the board’s name past a two-column mark', () => {
		const layout = { ...EMPTY_LAYOUT, people: [row(2, 'human')] }
		const [first, second, third] = lines_of(header({ activity: BEATING, layout, repo: KIT }))

		expect(start_of(second, '-')).toBe(start_of(first, BOARD_NAME))
		expect(start_of(third, 'kit')).toBe(start_of(first, BOARD_NAME))
	})
})

// joshuafolkken/kit#7672: the column draws the board's name linked to kit, the kit version the
// supervisor runs linked to kit's releases, then the repository.
describe('run_board_header.header_lines — the board’s name and the kit version', () => {
	it('links the board’s name to kit and the version to its releases', () => {
		const [first, second] = header_of({ kit_version: VERSION, comment_link: markdown_link })

		expect(first?.startsWith('⏸ [josh-board](https://github.com/joshuafolkken/kit) ')).toBe(true)
		expect(second).toContain(`[${VERSION}](https://github.com/joshuafolkken/kit/releases)`)
	})

	it('draws - where no version was recorded', () => {
		const [, second] = header_of({ comment_link: markdown_link })

		expect(second).toMatch(/^ {2}- +💪/u)
	})

	it('draws a single run’s name in the board’s place', () => {
		const [first] = header_of({ run_name: SINGLE_NAME })

		expect(first).toMatch(new RegExp(`^⏸ ${SINGLE_NAME} {2}⏰`, 'u'))
	})

	it('keeps the times in one column on all three lines past a version wider than the name', () => {
		const [first, second, third] = moving_of({ kit_version: WIDE_VERSION, repo: KIT })

		expect(second?.startsWith(`  ${WIDE_VERSION}  `)).toBe(true)
		expect(start_of(third, SPINNER)).toBe(start_of(first, '⏰'))
	})
})

// joshuafolkken/kit#8514: the tallies moved to the lanes rule, so the gauge's column answers to
// nothing above it and stays put whatever the count and the percent are.
describe('run_board_header.header_lines — the gauge column', () => {
	it('keeps the first machine bar where it is as the count and the percent gain a digit', () => {
		const counts: Array<[number, number]> = [
			[1, 2],
			[10, 12],
			[100, 120],
		]
		const starts = [9, 100].flatMap((cpu) =>
			counts.map(([settled, total]) => {
				const [, second] = header_of({ layout: plan(settled, total), machine: machine(cpu) })

				expect(second).toContain(`${String(cpu)}% `)

				return bar_start_of(second, '💪')
			}),
		)

		expect(new Set(starts).size).toBe(1)
	})
})

// A chat draws the memory alone, and a board before its first sample no gauge at all: the times
// stand where a screen's do, and what is drawn of the machine starts where a screen's does.
describe('run_board_header.header_lines — with marks left out', () => {
	it('keeps the times of a chat where a screen draws them, the 🧠 bar where a screen’s 💪 bar starts', () => {
		const screen = header_of({ machine: machine(11), repo: KIT })
		const chat = header_of({ machine: machine(11), repo: KIT, form: 'chat' })

		expect(chat[1]).not.toContain('💪')
		expect(start_of(chat[0], '⏰')).toBe(start_of(screen[0], '⏰'))
		expect(bar_start_of(chat[1], '🧠')).toBe(bar_start_of(screen[1], '💪'))
	})

	it('keeps the machine in its column with no heartbeat and no machine read', () => {
		const activity = { last_event_ms: undefined, is_stopped: false }
		const [, unread] = header_of({ activity })
		const [, read] = header_of({ machine: machine(9) })

		expect(unread).not.toContain('💓')
		expect(start_of(unread, '💪')).toBe(start_of(read, '💪'))
	})
})

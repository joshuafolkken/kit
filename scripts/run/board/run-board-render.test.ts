import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_phase, type Phase } from './run-board-phase'
import { run_board_render } from './run-board-render'
import { run_board_render_condition } from './run-board-render-condition'
import { run_board_render_fixture } from './run-board-render-fixture'
import { run_board_render_lead } from './run-board-render-lead'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#3430: the board as a person reads it. joshuafolkken/kit#3444: a row carries its
// number, title, elapsed span; sections are rules, symbols a legend.

const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, board_usage, header, lines_of, note, rule } =
	run_board_render_fixture
const SECOND = 1000
// A queued or waiting row's condition column where it names no condition (joshuafolkken/kit#4288).
const BLANK_CONDITION = ' '.repeat(run_board_render_condition.CONDITION_WIDTH)
// A lane row's indent, its two-column progress column and the blank after it, up to its phase icon
// (joshuafolkken/kit#4292).
const PROGRESS_WIDTH = 2
const LANE_LEAD = ' '.repeat(run_board_render_lead.LANE_INDENT.length + PROGRESS_WIDTH + 1)
const { TIME_WIDTH } = run_board_render_lead
const ZERO = '0″'
const ISSUE_1 = '1       Issue 1'
const ISSUE_2 = '2       Issue 2'
const ENDED_AT_30 = run_board_labels.day_minute_of(STARTED + 30 * MINUTE)
const ENDED_AT_1 = run_board_labels.day_minute_of(STARTED + MINUTE)

// A lane row with no phase time or spinner: its icon, the elapsed time right-aligned in its column,
// then what follows (the number, kind, title).
function lane_of(icon: string, elapsed: string, rest: string): string {
	return `${LANE_LEAD}${icon} ${''.padStart(TIME_WIDTH)} ${elapsed.padStart(TIME_WIDTH)} ${rest}`
}

function row(number: number, extra: Partial<BoardRow> = {}): BoardRow {
	return {
		number,
		title: `Issue ${String(number)}`,
		state: 'waiting',
		status: undefined,
		kind: undefined,
		waits: [],
		...extra,
	}
}

function passed_of(phase: Phase): Array<Phase> {
	return run_board_phase.PHASES.slice(0, run_board_phase.PHASES.indexOf(phase) + 1)
}

// A running row whose phases are `track` — the phases up to `phase` in the order a run passes them
// where one phase is named, as a child that never went back would have passed them.
function running(number: number, started_ms: number, phase: Phase | ItemStatus['track']): BoardRow {
	const track = typeof phase === 'string' ? passed_of(phase) : phase

	return row(number, { state: 'running', status: { state: 'running', started_ms, track } })
}

function padded(title: string): string {
	return title.padEnd(run_board_render.TITLE_LIMIT)
}

describe('run_board_render.render rows', () => {
	it('draws a running row with its phase icon, elapsed time, number and title, and no usage', () => {
		const layout = { ...EMPTY_LAYOUT, active: [running(1, STARTED + 40 * MINUTE, 'implement')] }
		const lines = lines_of(header({ layout }))
		const row_line = lane_of('🔨', '1°30′00″', ISSUE_1)

		expect(lines).toContain(row_line)
		expect(row_line).not.toContain('■')
		expect(lines.slice(0, -2).join('\n')).not.toContain('implement')
		expect(lines.some((line) => /^── 🧵 lanes ─+ ⏰ ─+$/u.test(line))).toBe(true)
	})

	it('ends an elapsed time of hours and one of seconds in the same column', () => {
		const long = running(1, NOW - 125 * MINUTE - 30 * SECOND, 'review')
		const short = running(2, NOW - 42 * SECOND, 'investigate')
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, active: [long, short] } }))
		const ends = ['2°05′30″', '42″'].map((time) => {
			const line = lines.find((text) => text.includes(time)) ?? ''

			return line.indexOf(time) + time.length
		})

		expect(ends[0]).toBe(ends[1])
	})
})

describe('run_board_render.render done rows', () => {
	it('draws a settled row with its whole span and nothing after it', () => {
		const status = {
			state: 'merged' as const,
			started_ms: STARTED,
			ended_ms: STARTED + 30 * MINUTE,
		}
		const layout = { ...EMPTY_LAYOUT, active: [row(2, { state: 'merged', status })] }

		expect(lines_of(header({ layout }))).toContain(
			`    ✅ ${ENDED_AT_30} 2       ${padded('Issue 2')}  30′00″`,
		)
	})

	it('draws no time for a child settled without a recorded end', () => {
		const status = { state: 'done' as const, started_ms: STARTED }
		const layout = { ...EMPTY_LAYOUT, active: [row(3, { state: 'done', status })] }

		expect(lines_of(header({ layout }))).toContain(`    🏁 ${BLANK_CONDITION} 3       Issue 3`)
	})
})

// joshuafolkken/kit#3577: the release kind's icon between the number and the title, one space either
// side; a row with no kind draws two blank columns, so every title starts in one column.
describe('run_board_render.render release kinds', () => {
	it('draws each kind’s icon after the number, and a blank of its width where none is', () => {
		const status = { state: 'merged' as const, started_ms: STARTED, ended_ms: STARTED + MINUTE }
		const kinds = [
			row(1, { kind: 'breaking-change', state: 'merged', status }),
			row(2, { kind: 'enhancement', state: 'merged', status }),
			row(3, { kind: 'bug', state: 'merged', status }),
			row(4, { state: 'merged', status }),
		]
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, active: kinds } }))

		expect(lines).toContain(`    ✅ ${ENDED_AT_1} 1    🧨 ${padded('Issue 1')}  1′00″`)
		expect(lines).toContain(`    ✅ ${ENDED_AT_1} 2    ✨ ${padded('Issue 2')}  1′00″`)
		expect(lines).toContain(`    ✅ ${ENDED_AT_1} 3    🐛 ${padded('Issue 3')}  1′00″`)
		expect(lines).toContain(`    ✅ ${ENDED_AT_1} 4       ${padded('Issue 4')}  1′00″`)
	})

	// joshuafolkken/kit#4026: a waiting row's title is not padded, so what it waits on follows it.
	it('starts the waits of a waiting row two blanks after its title, or its kind with no title', () => {
		const untitled = row(12, { kind: 'enhancement', title: undefined, waits: ['3'] })
		const titled = row(13, { kind: 'enhancement', waits: ['3'] })
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, active: [untitled, titled] } }))
		const columns = ['12    ✨', '13    ✨'].map(
			(mark) => lines.find((line) => line.includes(mark)) ?? '',
		)

		expect(columns[0]).toMatch(/^ {5}⏳ +12 {4}✨ {2}🔗 3$/u)
		expect(columns[1]).toMatch(/^ {5}⏳ +13 {4}✨ \S.* {2}🔗 3$/u)
	})

	it('names the drawn kinds in the legend', () => {
		const layout = { ...EMPTY_LAYOUT, active: [row(1, { kind: 'bug' }), row(2)] }

		expect(lines_of(header({ layout })).slice(-2)).toStrictEqual(['', '⏰ elapsed  🐛 fix'])
	})
})

// joshuafolkken/kit#4079: a row waiting on its declared start time leads with 📅.
// joshuafolkken/kit#4288: its start time fills the condition column, and the legend names 📅.
describe('run_board_render.render a row waiting on its start time', () => {
	it('leads the row with 📅 and its start time, and names 📅 in the legend', () => {
		const reason = { icon: '📅', value: '01-01 09:00', not_before_ms: 0 }
		const dated = { kind: 'row' as const, row: row(14, { reason }) }
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, queued: [dated] } }))

		expect(lines).toContain('    📅 01-01 09:00 14       Issue 14')
		expect(lines.at(-1)).toBe('📅 not before')
	})
})

describe('run_board_render.render sections', () => {
	it('draws an epic with its title as a tree, a wait as a link, and cuts a long title', () => {
		const long_title = 'x'.repeat(run_board_render.TITLE_LIMIT + 5)
		const reason = { icon: '🔗', issues: ['3409', '3410'] }
		const long = row(5, { title: long_title, waits: ['3409', '3410'], reason })
		const children = [row(11), row(12)]
		const epic = { kind: 'epic' as const, epic: 10, title: 'Epic ten', rows: children }
		const layout = { ...EMPTY_LAYOUT, queued: [epic, { kind: 'row' as const, row: long }] }
		const lines = lines_of(header({ layout }))
		const queued_rule = rule('⏳ queued')

		expect(lines.slice(lines.indexOf(queued_rule), -2)).toStrictEqual([
			queued_rule,
			'    📁 10  Epic ten',
			`       ├ ⏳ ${BLANK_CONDITION} 11       Issue 11`,
			`       └ ⏳ ${BLANK_CONDITION} 12       Issue 12`,
			`    🔗 3409+1      5       ${'x'.repeat(run_board_render.TITLE_LIMIT - 1)}…  3410`,
		])
	})

	it('keeps a title at the limit whole, so a forty-eight column title is not cut', () => {
		const title = 'y'.repeat(run_board_render.TITLE_LIMIT)
		const layout = { ...EMPTY_LAYOUT, active: [row(7, { title })] }

		expect(run_board_render.TITLE_LIMIT).toBe(48)
		expect(lines_of(header({ layout }))).toContain(lane_of('⏳', '', `7       ${title}`))
	})

	// joshuafolkken/kit#4173: the rule names 🙋, so no legend is drawn for it.
	it('draws a decision row under the decision rule, which names 🙋 in place of the legend', () => {
		const layout = { ...EMPTY_LAYOUT, people: [row(6, { state: 'human' })] }
		const lines = lines_of(header({ layout }))
		const decision_rule = rule('🙋 decision')
		const decision_row = '    🙋 6       Issue 6'
		const start = lines.indexOf(decision_rule)

		expect(lines.slice(start, start + 2)).toStrictEqual([decision_rule, decision_row])
		expect(lines.at(-1)).toBe(decision_row)
	})
})

// A chat is read beside the board on screen, so its plan, findings and legend are the screen's own.
describe('run_board_render.render chat', () => {
	it('draws a chat as a screen: titles cut, finish times, findings icons and the legend', () => {
		const long_title = 'x'.repeat(run_board_render.TITLE_LIMIT + 5)
		const merged = row(1, {
			state: 'merged',
			title: long_title,
			status: { state: 'merged', started_ms: STARTED, ended_ms: NOW - MINUTE, track: ['ship'] },
		})
		const layout = { ...EMPTY_LAYOUT, active: [merged, running(2, NOW - MINUTE, 'review')] }
		const notes = [note(NOW, 'seen')]
		const usages = board_usage(new Map())
		const screen = lines_of(header({ layout, usages }), notes)
		const lines = lines_of(header({ layout, usages, form: 'chat' }), notes)

		expect(lines).toStrictEqual(screen)
		expect(lines.join('\n')).toMatch(
			/── 📌 findings [^]*\n.*x… {2}2°09′00″\n\n👀 review {2}⏰ elapsed {2}💬 note$/u,
		)
	})

	it('draws a chat’s done row with its end time in place of the finish mark', () => {
		const status = { state: 'merged' as const, started_ms: STARTED, ended_ms: NOW - MINUTE }
		const layout = { ...EMPTY_LAYOUT, active: [row(1, { state: 'merged', status })] }
		const text = lines_of(header({ layout, form: 'chat' })).join('\n')

		expect(text).toContain(`✅ ${run_board_labels.day_minute_of(NOW - MINUTE)} 1 `)
		expect(text).not.toContain('🔚')
	})
})

// joshuafolkken/kit#3452: the phase icons the legend names, the spinner a running row turns, and an
// output with no color.
describe('run_board_render.render phase icons and spinner', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	// joshuafolkken/kit#3471: and the indent a running row turns its spinner in stays blank.
	it('draws no escape and a blank indent where the output has no color and no spinner', () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const active = [running(1, NOW, 'review'), row(2)]
		const board = header({ layout: { ...EMPTY_LAYOUT, active } })
		const text = run_board_render.render({ header: board, notes: [] }).join('\n')

		expect(text).not.toContain('\u{1B}')
		expect(text).toContain(`\n${lane_of('👀', ZERO, ISSUE_1)}`)
		expect(text).toContain('▶ backlogrun')
	})
})

const segmenter = new Intl.Segmenter()

// Where `text` starts in `line`, in graphemes: every row icon is one, so equal counts are one column.
function column_of(line: string, text: string): number {
	return [...segmenter.segment(line.slice(0, line.indexOf(text)))].length
}

// joshuafolkken/kit#3471: a running row turns the spinner in its indent and leads with its phase.
describe('run_board_render.render running row lead', () => {
	it('turns the spinner in a running row’s indent only, its title in every row’s column', () => {
		const active = [running(1, NOW, 'review'), row(2)]
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, active }, spinner: '⠋' }))
		const spun = lines.find((line) => line.includes('Issue 1')) ?? ''
		const still = lines.find((line) => line.includes('Issue 2')) ?? ''

		expect(spun).toBe(`  ⠋  👀 ${''.padStart(TIME_WIDTH)} ${ZERO.padStart(TIME_WIDTH)} ${ISSUE_1}`)
		expect(still).toBe(lane_of('⏳', '', ISSUE_2))
		expect(column_of(spun, 'Issue 1')).toBe(column_of(still, 'Issue 2'))
	})

	it('turns the spinner in the first column of a running epic child’s branch', () => {
		const rows = [running(4, NOW, 'gate'), row(5)]
		const queued = [{ kind: 'epic' as const, epic: 9, title: 'Epic', rows }]
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, queued }, spinner: '⠙' }))

		expect(lines.join('\n')).toContain(`⠙      ├ 🚦 ${BLANK_CONDITION} 4       Issue 4`)
		expect(lines).toContain(`       └ ⏳ ${BLANK_CONDITION} 5       Issue 5`)
	})

	it('leads a running row with its newest phase’s icon, and 🔄 before it reaches one', () => {
		const active = [running(1, NOW, 'commit'), running(2, NOW, undefined)]
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, active } }))

		expect(lines).toContain(lane_of('📦', ZERO, ISSUE_1))
		expect(lines).toContain(lane_of('🔄', ZERO, ISSUE_2))
	})
})

describe('run_board_render.render running row legend', () => {
	// joshuafolkken/kit#3480: the legend is told the icon each row leads with, not its state's.
	it('names 🔄 in the legend only while a row draws it, not for a row led by its phase', () => {
		const led = lines_of(
			header({ layout: { ...EMPTY_LAYOUT, active: [running(1, NOW, 'review')] } }),
		)
		const spun = lines_of(
			header({ layout: { ...EMPTY_LAYOUT, active: [running(2, NOW, undefined)] } }),
		)

		expect(led.at(-1)).not.toContain('🔄')
		expect(spun.at(-1)).toBe('🔄 running  ⏰ elapsed')
	})
})

// joshuafolkken/kit#3450: a stand-in for the terminal link, visible so the test sees where it lands.
function bracketed(reference: string): string {
	return `[${reference}]`
}

describe('run_board_render.render links', () => {
	const settled = { state: 'merged' as const, started_ms: STARTED, ended_ms: STARTED + MINUTE }
	const active = [row(2, { state: 'merged', status: settled, waits: ['other/repo#7'] })]
	const epic = { kind: 'epic' as const, epic: 10, title: undefined, rows: [row(11)] }
	const layout = { ...EMPTY_LAYOUT, active, queued: [epic] }

	it('links every issue number, the epic and the wait', () => {
		const lines = lines_of(header({ layout, link: bracketed }))

		expect(lines).toContain('    📁 [10]')
		expect(lines).toContain(`       └ ⏳ ${BLANK_CONDITION} [11]       Issue 11`)
		expect(lines.join('\n')).toContain('🔗 [other/repo#7]')
	})

	it('pads the title before the number is linked, so the time column does not move', () => {
		const linked = lines_of(header({ layout, link: bracketed }))
		const plain = lines_of(header({ layout }))

		expect(linked).toContain(
			`    ✅ ${ENDED_AT_1} [2]       ${padded('Issue 2')}  1′00″  🔗 [other/repo#7]`,
		)
		expect(plain).toContain(
			`    ✅ ${ENDED_AT_1} 2       ${padded('Issue 2')}  1′00″  🔗 other/repo#7`,
		)
	})
})

describe('run_board_render.render header', () => {
	it('counts the progress with the arrivals since the board first looked', () => {
		const active = [row(1, { state: 'merged' }), row(2, { state: 'running' })]
		const layout = { ...EMPTY_LAYOUT, active, unreached: [row(3)] }
		const progress = lines_of(header({ layout, baseline_total: 2 }))[0] ?? ''

		expect(progress).toMatch(/ {2}✅ {2}1\/3 \S+ \(\+1\)/u)
		expect(progress).toContain('(+1)  🔄 1  ⏳ 1  💤 0')
	})
})

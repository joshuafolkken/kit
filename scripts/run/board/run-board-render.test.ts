import { stripVTControlCharacters } from 'node:util'
import type { IdleWindow } from '#scripts/backlog/backlog-idle'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_phase, type Phase } from './run-board-phase'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { ItemStatus } from './run-board-status'
import { run_board_track } from './run-board-track'

// joshuafolkken/kit#3430: the board as a person reads it. Expected clocks are built with the board's own
// `clock_of`, so the assertions hold in any time zone. joshuafolkken/kit#3444: a row carries its number,
// title, elapsed `MM:SS` and its phase track; sections are rules, symbols a legend.

const { clock_of } = run_board_labels
const { EMPTY_LAYOUT, MINUTE, NOW, STARTED, WORDS, header, lines_of, note, rule } =
	run_board_render_fixture
const SECOND = 1000

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

// A running row whose phases are `track` — the phases up to `phase` in the track's order where one
// phase is named, as a child that never went back would have passed them.
function running(number: number, started_ms: number, phase: Phase | ItemStatus['track']): BoardRow {
	const track = typeof phase === 'string' ? passed_of(phase) : phase

	return row(number, { state: 'running', status: { state: 'running', started_ms, track } })
}

function padded(title: string): string {
	return title.padEnd(run_board_render.TITLE_LIMIT)
}

// The phase track as the stripped lines draw it, whether or not this run's output is colored.
function plain_track(phase: Phase): string {
	return stripVTControlCharacters(run_board_track.track_of(passed_of(phase)))
}

describe('run_board_render.render rows', () => {
	it('draws a running row with its number, title, elapsed time and phase track, and no lane', () => {
		const layout = { ...EMPTY_LAYOUT, active: [running(1, STARTED + 40 * MINUTE, 'implement')] }
		const lines = lines_of(header({ layout }))
		const row_line = `  🔨 1    ${padded('Issue 1')}  90:00  ${plain_track('implement')}`

		expect(lines).toContain(row_line)
		expect(row_line).not.toContain('■')
		expect(lines.slice(0, -2).join('\n')).not.toContain('implement')
		expect(lines.join('\n')).not.toContain('lane')
	})

	it('ends a three-digit elapsed time and a two-digit one in the same column', () => {
		const long = running(1, NOW - 125 * MINUTE - 30 * SECOND, 'review')
		const short = running(2, NOW - 42 * SECOND, 'investigate')
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, active: [long, short] } }))
		const ends = ['125:30', '00:42'].map((time) => {
			const line = lines.find((text) => text.includes(time)) ?? ''

			return line.indexOf(time) + time.length
		})

		expect(ends[0]).toBe(ends[1])
	})

	it('draws a settled row with no track with its whole span and nothing after it', () => {
		const status = {
			state: 'merged' as const,
			started_ms: STARTED,
			ended_ms: STARTED + 30 * MINUTE,
		}
		const layout = { ...EMPTY_LAYOUT, active: [row(2, { state: 'merged', status })] }

		expect(lines_of(header({ layout }))).toContain(`  ✅ 2    ${padded('Issue 2')}  30:00`)
	})

	it('draws no time for a child settled without a recorded end', () => {
		const status = { state: 'done' as const, started_ms: STARTED }
		const layout = { ...EMPTY_LAYOUT, active: [row(3, { state: 'done', status })] }

		expect(lines_of(header({ layout }))).toContain('  🏁 3    Issue 3')
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

		expect(lines).toContain(`  ✅ 1 🧨 ${padded('Issue 1')}  01:00`)
		expect(lines).toContain(`  ✅ 2 ✨ ${padded('Issue 2')}  01:00`)
		expect(lines).toContain(`  ✅ 3 🐛 ${padded('Issue 3')}  01:00`)
		expect(lines).toContain(`  ✅ 4    ${padded('Issue 4')}  01:00`)
	})

	it('keeps the usual gap before the waits of a row with no title', () => {
		const untitled = row(12, { kind: 'enhancement', title: undefined, waits: ['3'] })
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, active: [untitled] } }))

		expect(lines).toContain('  ⏳ 12 ✨  🔗 3')
	})

	it('names the drawn kinds in the legend', () => {
		const layout = { ...EMPTY_LAYOUT, active: [row(1, { kind: 'bug' }), row(2)] }

		expect(lines_of(header({ layout })).at(-1)).toBe('⏳ waiting  🐛 fix')
	})
})

describe('run_board_render.render sections', () => {
	it('draws an epic with its title as a tree, a wait as a link, and cuts a long title', () => {
		const long_title = 'x'.repeat(run_board_render.TITLE_LIMIT + 5)
		const long = row(5, { title: long_title, waits: ['3409'] })
		const children = [row(11), row(12)]
		const epic = { kind: 'epic' as const, epic: 10, title: 'Epic ten', rows: children }
		const layout = { ...EMPTY_LAYOUT, waves: [[epic, { kind: 'row' as const, row: long }]] }
		const lines = lines_of(header({ layout }))
		const wave_rule = rule('1')

		expect(lines.slice(lines.indexOf(wave_rule), -4)).toStrictEqual([
			wave_rule,
			'  📁 10  Epic ten',
			'     ├ ⏳ 11    Issue 11',
			'     └ ⏳ 12    Issue 12',
			`  ⏳ 5    ${'x'.repeat(run_board_render.TITLE_LIMIT - 1)}…  🔗 3409`,
		])
	})

	it('keeps a title at the limit whole, so a forty-eight column title is not cut', () => {
		const title = 'y'.repeat(run_board_render.TITLE_LIMIT)
		const layout = { ...EMPTY_LAYOUT, active: [row(7, { title })] }

		expect(run_board_render.TITLE_LIMIT).toBe(48)
		expect(lines_of(header({ layout }))).toContain(`  ⏳ 7    ${title}`)
	})

	it('draws a decision row under the people rule and the legend at the foot', () => {
		const layout = { ...EMPTY_LAYOUT, people: [row(6, { state: 'human' })] }
		const lines = lines_of(header({ layout }))
		const people_rule = rule('🙋')
		const start = lines.indexOf(people_rule)

		expect(lines.slice(start, start + 2)).toStrictEqual([people_rule, '  🙋 6    Issue 6'])
		expect(lines.at(-1)).toBe('🙋 decision')
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
		const screen = lines_of(header({ layout, usages: new Map() }), notes)
		const lines = lines_of(header({ layout, usages: new Map(), form: 'chat' }), notes)

		expect(lines).toStrictEqual(screen)
		expect(lines.join('\n')).toMatch(/x… {2}.*🔚 .*\n[^]*── 📌 [^]*\n.*✅ merged/u)
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
		expect(text).toContain('\n  👀 1    Issue 1')
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

		expect(spun.startsWith('⠋ 👀 1    Issue 1')).toBe(true)
		expect(still).toBe('  ⏳ 2    Issue 2')
		expect(column_of(spun, 'Issue 1')).toBe(column_of(still, 'Issue 2'))
	})

	it('turns the spinner in the first column of a running epic child’s branch', () => {
		const rows = [running(4, NOW, 'gate'), row(5)]
		const waves = [[{ kind: 'epic' as const, epic: 9, title: 'Epic', rows }]]
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, waves }, spinner: '⠙' }))

		expect(lines.some((line) => line.startsWith('⠙    ├ 🚦 4    Issue 4'))).toBe(true)
		expect(lines).toContain('     └ ⏳ 5    Issue 5')
	})

	it('leads a running row with its newest phase’s icon, and 🔄 before its track draws one', () => {
		const active = [running(1, NOW, 'commit'), running(2, NOW, undefined)]
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, active } }))

		expect(lines.some((line) => line.startsWith('  📦 1    Issue 1'))).toBe(true)
		expect(lines.some((line) => line.startsWith('  🔄 2    Issue 2'))).toBe(true)
	})

	// joshuafolkken/kit#3480: the legend is told the icon each row leads with, not its state's.
	it('names 🔄 in the legend only while a row draws it, not for a row led by its phase', () => {
		const led = lines_of(
			header({ layout: { ...EMPTY_LAYOUT, active: [running(1, NOW, 'review')] } }),
		)
		const spun = lines_of(
			header({ layout: { ...EMPTY_LAYOUT, active: [running(2, NOW, undefined)] } }),
		)

		expect(led.at(-1)).not.toContain('🔄')
		expect(spun.at(-1)).toBe('🔄 running')
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
	const layout = { ...EMPTY_LAYOUT, active, waves: [[epic]] }

	it('links every issue number, the epic and the wait', () => {
		const lines = lines_of(header({ layout, link: bracketed }))

		expect(lines).toContain('  📁 [10]')
		expect(lines).toContain('     └ ⏳ [11]    Issue 11')
		expect(lines.join('\n')).toContain('🔗 [other/repo#7]')
	})

	it('pads the title before the number is linked, so the time column does not move', () => {
		const linked = lines_of(header({ layout, link: bracketed }))
		const plain = lines_of(header({ layout }))

		expect(linked).toContain(`  ✅ [2]    ${padded('Issue 2')}  01:00  🔗 [other/repo#7]`)
		expect(plain).toContain(`  ✅ 2    ${padded('Issue 2')}  01:00  🔗 other/repo#7`)
	})
})

describe('run_board_render.render header', () => {
	it('counts the progress with the arrivals since the board first looked', () => {
		const active = [row(1, { state: 'merged' }), row(2, { state: 'running' })]
		const layout = { ...EMPTY_LAYOUT, active, unreached: [row(3)] }
		const progress = lines_of(header({ layout, baseline_total: 2 }))[0] ?? ''

		expect(progress).toMatch(/ {2}✅ 1\/3 \S+ \(\+1\)/u)
		expect(progress).toContain('(+1)  🔄 1  ⏳ 1  💤 0')
	})

	it('says until when an idle run waits, what ends the wait and when it next looks', () => {
		const idle: IdleWindow = {
			since_ms: NOW - 10 * MINUTE,
			until_ms: NOW + 20 * MINUTE,
			bound: 'idle',
			asked_ms: NOW - 3 * MINUTE,
		}
		const activity = { last_event_ms: NOW, idle, is_stopped: false }
		const lines = lines_of(header({ activity, layout: undefined }))

		const until = `wait ends ${clock_of(idle.until_ms)} (20:00 left) → ${WORDS.idle_end_idle}`

		expect(lines[0]).toMatch(/^⏸ backlogrun/u)
		expect(lines.slice(2, 4)).toStrictEqual([
			'',
			`  ⏸ ${until} · next check ${clock_of(NOW + 2 * MINUTE)}`,
		])
	})
})

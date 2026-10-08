import { stripVTControlCharacters } from 'node:util'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import type { IdleWindow } from '#scripts/backlog/backlog-idle'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { BoardNote } from './run-board-notes'
import type { Phase } from './run-board-phase'
import { run_board_render } from './run-board-render'
import type { ItemStatus } from './run-board-status'
import { run_board_track } from './run-board-track'

// joshuafolkken/kit#3430: the board as a person reads it. Expected clocks are built with the board's own
// `clock_of`, so the assertions hold in any time zone. joshuafolkken/kit#3444: a row carries its number,
// title, elapsed `MM:SS` and — while running — its phase track; sections are rules, symbols a legend.

const { clock_of } = run_board_labels
const WORDS = run_board_labels.words_of('ja')
const SECOND = 1000
const MINUTE = backlog_budget.MS_PER_MINUTE
const STARTED = Date.parse('2026-10-08T09:00:00.000Z')
const NOW = STARTED + 130 * MINUTE
const EMPTY_LAYOUT: BoardLayout = { active: [], waves: [], people: [], unreached: [] }

function row(number: number, extra: Partial<BoardRow> = {}): BoardRow {
	return {
		number,
		title: `Issue ${String(number)}`,
		state: 'waiting',
		status: undefined,
		waits: [],
		...extra,
	}
}

function running(number: number, started_ms: number, phase: ItemStatus['phase']): BoardRow {
	return row(number, { state: 'running', status: { state: 'running', started_ms, phase } })
}

function header(extra: Partial<BoardHeader> = {}): BoardHeader {
	return {
		now_ms: NOW,
		words: WORDS,
		started_ms: STARTED,
		ended_ms: undefined,
		activity: { last_event_ms: NOW - MINUTE, idle: undefined, is_stopped: false },
		layout: EMPTY_LAYOUT,
		baseline_total: undefined,
		plan_fetched_ms: NOW,
		plan_failed_ms: undefined,
		machine: undefined,
		spinner: undefined,
		link: (reference) => reference,
		...extra,
	}
}

function lines_of(board: BoardHeader, notes: ReadonlyArray<BoardNote> = []): Array<string> {
	return run_board_render
		.render({ header: board, notes })
		.map((line) => stripVTControlCharacters(line))
}

function padded(title: string): string {
	return title.padEnd(run_board_render.TITLE_LIMIT)
}

// The phase track as the stripped lines draw it, whether or not this run's output is colored.
function plain_track(phase: Phase): string {
	return stripVTControlCharacters(run_board_track.track_of(phase))
}

function rule(label: string): string {
	return `── ${label} `.padEnd(50, '─')
}

function note(at_ms: number, text: string): BoardNote {
	return { kind: 'note', at_ms, issue: '3415', text, is_decision: false }
}

describe('run_board_render.render rows', () => {
	it('draws a running row with its number, title, elapsed time and phase track, and no lane', () => {
		const layout = { ...EMPTY_LAYOUT, active: [running(1, STARTED + 40 * MINUTE, 'implement')] }
		const lines = lines_of(header({ layout }))
		const row_line = `  🔨 1  ${padded('Issue 1')}  90:00  ${plain_track('implement')}`

		expect(lines).toContain(row_line)
		expect(row_line).not.toContain('█')
		expect(lines.join('\n')).not.toContain('implement')
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

	it('draws a settled row with its whole span and no phase bar', () => {
		const status = {
			state: 'merged' as const,
			started_ms: STARTED,
			ended_ms: STARTED + 30 * MINUTE,
		}
		const layout = { ...EMPTY_LAYOUT, active: [row(2, { state: 'merged', status })] }

		expect(lines_of(header({ layout }))).toContain(`  ✅ 2  ${padded('Issue 2')}  30:00`)
	})

	it('draws no time for a child settled without a recorded end', () => {
		const status = { state: 'done' as const, started_ms: STARTED }
		const layout = { ...EMPTY_LAYOUT, active: [row(3, { state: 'done', status })] }

		expect(lines_of(header({ layout }))).toContain('  🏁 3  Issue 3')
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

		expect(lines.slice(lines.indexOf(wave_rule), -2)).toStrictEqual([
			wave_rule,
			'  📁 10  Epic ten',
			'     ├ ⏳ 11  Issue 11',
			'     └ ⏳ 12  Issue 12',
			`  ⏳ 5  ${'x'.repeat(run_board_render.TITLE_LIMIT - 1)}…  🔗 3409`,
		])
	})

	it('keeps a title at the limit whole, so a forty-eight column title is not cut', () => {
		const title = 'y'.repeat(run_board_render.TITLE_LIMIT)
		const layout = { ...EMPTY_LAYOUT, active: [row(7, { title })] }

		expect(run_board_render.TITLE_LIMIT).toBe(48)
		expect(lines_of(header({ layout }))).toContain(`  ⏳ 7  ${title}`)
	})

	it('draws a decision row under the people rule and the legend at the foot', () => {
		const layout = { ...EMPTY_LAYOUT, people: [row(6, { state: 'human' })] }
		const lines = lines_of(header({ layout }))
		const people_rule = rule('🙋')
		const start = lines.indexOf(people_rule)

		expect(lines.slice(start, start + 2)).toStrictEqual([people_rule, '  🙋 6  Issue 6'])
		expect(lines.at(-1)).toBe(
			'✅ マージ  💤 park  🔄 実行中  🛑 停止  ⏳ 待ち  🙋 判断待ち  🔗 待ち先  ⚡ cpu  🧠 mem  💾 swap  📊 進捗  🔚 終了',
		)
	})
})

// joshuafolkken/kit#3452: the phase icons the legend names, the spinner a running row turns, and an
// output with no color.
describe('run_board_render.render phase icons and spinner', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('names in the legend only the phases a row on screen draws, in the phases’ order', () => {
		const active = [running(1, NOW, 'implement'), running(2, NOW, 'investigate')]
		const legend = lines_of(header({ layout: { ...EMPTY_LAYOUT, active } })).at(-1) ?? ''

		expect(legend).toContain('🔗 待ち先  🔍 調査  📝 計画  🔨 実装  ⚡ cpu')
		expect(legend).not.toContain('👀')
	})

	it('names no phase in the legend for a dispatched child, whose track draws no icon', () => {
		const active = [running(1, NOW, 'dispatched')]
		const legend = lines_of(header({ layout: { ...EMPTY_LAYOUT, active } })).at(-1) ?? ''

		expect(legend).toContain('🔗 待ち先  ⚡ cpu')
	})

	// joshuafolkken/kit#3471: and the indent a running row turns its spinner in stays blank.
	it('draws no escape and a blank indent where the output has no color and no spinner', () => {
		vi.stubEnv('FORCE_COLOR', '0')
		const active = [running(1, NOW, 'review'), row(2)]
		const board = header({ layout: { ...EMPTY_LAYOUT, active } })
		const text = run_board_render.render({ header: board, notes: [] }).join('\n')

		expect(text).not.toContain('\u{1B}')
		expect(text).toContain('\n  👀 1  Issue 1')
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

		expect(spun.startsWith('⠋ 👀 1  Issue 1')).toBe(true)
		expect(still).toBe('  ⏳ 2  Issue 2')
		expect(column_of(spun, 'Issue 1')).toBe(column_of(still, 'Issue 2'))
	})

	it('turns the spinner in the first column of a running epic child’s branch', () => {
		const rows = [running(4, NOW, 'gate'), row(5)]
		const waves = [[{ kind: 'epic' as const, epic: 9, title: 'Epic', rows }]]
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, waves }, spinner: '⠙' }))

		expect(lines.some((line) => line.startsWith('⠙    ├ 🚦 4  Issue 4'))).toBe(true)
		expect(lines).toContain('     └ ⏳ 5  Issue 5')
	})

	it('leads a running row with its newest phase’s icon, and 🔄 before its track draws one', () => {
		const active = [running(1, NOW, 'commit'), running(2, NOW, 'dispatched')]
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, active } }))

		expect(lines.some((line) => line.startsWith('  📦 1  Issue 1'))).toBe(true)
		expect(lines.some((line) => line.startsWith('  🔄 2  Issue 2'))).toBe(true)
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
		expect(lines).toContain('     └ ⏳ [11]  Issue 11')
		expect(lines.join('\n')).toContain('🔗 [other/repo#7]')
	})

	it('pads the title before the number is linked, so the time column does not move', () => {
		const linked = lines_of(header({ layout, link: bracketed }))
		const plain = lines_of(header({ layout }))

		expect(linked).toContain(`  ✅ [2]  ${padded('Issue 2')}  01:00  🔗 [other/repo#7]`)
		expect(plain).toContain(`  ✅ 2  ${padded('Issue 2')}  01:00  🔗 other/repo#7`)
	})
})

describe('run_board_render.render header', () => {
	it('counts the progress with the arrivals since the board first looked', () => {
		const active = [row(1, { state: 'merged' }), row(2, { state: 'running' })]
		const layout = { ...EMPTY_LAYOUT, active, unreached: [row(3)] }
		const [, progress] = lines_of(header({ layout, baseline_total: 2 }))

		expect(progress).toContain('1/3 (+1)')
		expect(progress).toContain('✅ 1  💤 0  🔄 1  ⏳ 1')
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

		expect(lines[0]).toMatch(/^⏸ backlogrun/u)
		expect(lines[1]).toBe(
			`  待機終了 ${clock_of(idle.until_ms)} (残り 00:20:00) → ${WORDS.idle_end_idle}`,
		)
		expect(lines[2]).toBe(`  次の確認 ${clock_of(NOW + 2 * MINUTE)}`)
	})
})

describe('run_board_render findings and no run', () => {
	it('shows the newest findings and how many more there are', () => {
		const notes = Array.from({ length: run_board_render.NOTE_LIMIT + 2 }, (_, index) =>
			note(NOW - index * MINUTE, `observation ${String(index)}`),
		)
		const filed: BoardNote = {
			kind: 'filed',
			at_ms: NOW,
			issue: '3438',
			text: 'Count seats',
			found_during: '3415',
			is_decision: false,
		}
		const lines = lines_of(header({ layout: undefined }), [filed, ...notes])

		expect(lines).toContain(`  🐞 ${clock_of(NOW)} 3438 起票  Count seats（3415 の実装中に発見）`)
		expect(lines).toContain(`  💬 ${clock_of(NOW)} 3415 意見  observation 0`)
		expect(lines.at(-1)).toBe('  ほか 3')
	})

	it('says there is no run when none has started', () => {
		expect(run_board_render.render_no_run(NOW, WORDS)).toStrictEqual([
			`■ backlogrun  ランなし  ${clock_of(NOW)}`,
		])
	})
})

// joshuafolkken/kit#3437: a stopped run names the command that resumes its session, under the header.
describe('run_board_render.render resume', () => {
	it('draws the resume command only when the run stopped with a session', () => {
		const board = header({ layout: undefined, ended_ms: NOW })
		const resumed = run_board_render
			.render({ header: board, notes: [], resume: 'abc' })
			.map((line) => stripVTControlCharacters(line))

		expect(resumed).toContain('🙋 停止中。再開  claude --resume abc')
		expect(lines_of(board).join('\n')).not.toContain('claude --resume')
	})
})

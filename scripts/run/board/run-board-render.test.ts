import { stripVTControlCharacters } from 'node:util'
import { backlog_budget } from '#scripts/backlog/backlog-budget'
import type { IdleWindow } from '#scripts/backlog/backlog-idle'
import { describe, expect, it } from 'vitest'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { BoardNote } from './run-board-notes'
import { run_board_phase } from './run-board-phase'
import { run_board_render } from './run-board-render'
import type { ItemStatus } from './run-board-status'

// joshuafolkken/kit#3430: the board as a person reads it. Expected clocks are built with the board's own
// `clock_of`, so the assertions hold in any time zone. joshuafolkken/kit#3444: a row carries its number,
// title, elapsed `MM:SS` and — while running — its phase bar; sections are rules, symbols a legend.

const { bar_of, clock_of } = run_board_labels
const WORDS = run_board_labels.words_of('ja')
const SECOND = 1000
const MINUTE = backlog_budget.MS_PER_MINUTE
const STARTED = Date.parse('2026-10-08T09:00:00.000Z')
const NOW = STARTED + 130 * MINUTE
const EMPTY_LAYOUT: BoardLayout = { active: [], waves: [], people: [], unreached: [] }
const PHASE_COUNT = run_board_phase.PHASES.length

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
		activity: { last_event_ms: NOW - MINUTE, idle: undefined, is_stopped: false },
		layout: EMPTY_LAYOUT,
		baseline_total: undefined,
		plan_fetched_ms: NOW,
		plan_failed_ms: undefined,
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

function rule(label: string): string {
	return `── ${label} `.padEnd(50, '─')
}

function note(at_ms: number, text: string): BoardNote {
	return { kind: 'note', at_ms, issue: '3415', text, is_decision: false }
}

describe('run_board_render.render rows', () => {
	it('draws a running row with its elapsed time, phase bar and phase, and no lane', () => {
		const layout = { ...EMPTY_LAYOUT, active: [running(1, STARTED + 40 * MINUTE, 'implement')] }
		const lines = lines_of(header({ layout }))
		const bar = bar_of(run_board_phase.index_of('implement'), PHASE_COUNT)

		expect(lines).toContain(`  🔄 1  ${padded('Issue 1')}  90:00  ${bar} implement`)
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
			'     ├ 11  Issue 11',
			'     └ 12  Issue 12',
			`     5  ${'x'.repeat(run_board_render.TITLE_LIMIT - 1)}…  🔗 3409`,
		])
	})

	it('draws a decision row under the people rule and the legend at the foot', () => {
		const layout = { ...EMPTY_LAYOUT, people: [row(6, { state: 'human' })] }
		const lines = lines_of(header({ layout }))
		const people_rule = rule('🙋')
		const start = lines.indexOf(people_rule)

		expect(lines.slice(start, start + 2)).toStrictEqual([people_rule, '  🙋 6  Issue 6'])
		expect(lines.at(-1)).toBe('✅ マージ  💤 park  🔄 実行中  ⏳ 待ち  🙋 判断待ち  🔗 待ち先')
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

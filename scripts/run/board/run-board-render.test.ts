import { backlog_budget } from '#scripts/backlog/backlog-budget'
import type { IdleWindow } from '#scripts/backlog/backlog-idle'
import { describe, expect, it } from 'vitest'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardLayout, BoardRow } from './run-board-layout'
import type { BoardNote } from './run-board-notes'
import { run_board_render } from './run-board-render'

// joshuafolkken/kit#3430: the board as a person reads it. Expected clocks are built with the board's own
// `clock_of`, so the assertions hold in any time zone.

const { clock_of } = run_board_labels
const WORDS = run_board_labels.words_of('ja')
const MINUTE = backlog_budget.MS_PER_MINUTE
const STARTED = Date.parse('2026-10-08T09:00:00.000Z')
const NOW = STARTED + 90 * MINUTE
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
		...extra,
	}
}

function lines_of(board: BoardHeader, notes: ReadonlyArray<BoardNote> = []): Array<string> {
	return run_board_render.render({ header: board, notes })
}

function note(at_ms: number, text: string): BoardNote {
	return { kind: 'note', at_ms, issue: '3415', text, is_decision: false }
}

describe('run_board_render.render rows', () => {
	it('draws a running row with its start and elapsed time, and a settled row with its whole span', () => {
		const running = row(1, {
			state: 'running',
			status: { state: 'running', started_ms: STARTED, lane: 'lane 1' },
		})
		const merged_status = {
			state: 'merged' as const,
			started_ms: STARTED,
			ended_ms: STARTED + 30 * MINUTE,
		}
		const merged = row(2, { state: 'merged', status: merged_status })
		const lines = lines_of(header({ layout: { ...EMPTY_LAYOUT, active: [running, merged] } }))

		expect(lines).toContain(`  🔄 1  Issue 1  ${clock_of(STARTED)} (01:30:00)  lane 1`)
		expect(lines).toContain(
			`  ✅ 2  Issue 2  ${clock_of(STARTED)} → ${clock_of(STARTED + 30 * MINUTE)} (00:30:00)`,
		)
	})

	it('draws an epic as a tree, a wait as a note, and cuts a long title', () => {
		const long = row(5, { title: 'x'.repeat(run_board_render.TITLE_LIMIT + 5), waits: ['3409'] })
		const epic = { kind: 'epic' as const, epic: 10, rows: [row(11), row(12)] }
		const layout = { ...EMPTY_LAYOUT, waves: [[epic, { kind: 'row' as const, row: long }]] }
		const lines = lines_of(header({ layout }))

		expect(lines.slice(lines.indexOf('Wave 1'))).toStrictEqual([
			'Wave 1',
			'  📁 epic 10',
			'     ├ ⏳ 11  Issue 11',
			'     └ ⏳ 12  Issue 12',
			`  ⏳ 5  ${'x'.repeat(run_board_render.TITLE_LIMIT - 1)}…  ← 待ち: 3409`,
		])
	})
})

describe('run_board_render.render header', () => {
	it('states the run, its start, its cut-off and its last event', () => {
		const [title] = lines_of(header())
		const cutoff = clock_of(STARTED + backlog_budget.WHOLE_RUN_BUDGET_MS)

		expect(title).toBe(
			`backlogrun ⏸ 待機中 · 開始 ${clock_of(STARTED)} (01:30:00) · 打ち切り ${cutoff} · 最終イベント ${clock_of(NOW - MINUTE)} (00:01:00)`,
		)
	})

	it('counts the progress with the arrivals since the board first looked', () => {
		const active = [row(1, { state: 'merged' }), row(2, { state: 'running' })]
		const layout = { ...EMPTY_LAYOUT, active, unreached: [row(3)] }
		const progress = lines_of(header({ layout, baseline_total: 2 })).find((line) =>
			line.startsWith('進捗'),
		)

		expect(progress).toContain('進捗 1/3 (+1)')
		expect(progress).toContain('✅ 1 マージ · 🅿 0 park · 🔄 1 実行中 · ⏳ 1 残り')
	})

	it('says until when an idle run waits, what ends the wait and when it next looks', () => {
		const idle: IdleWindow = {
			since_ms: NOW - 10 * MINUTE,
			until_ms: NOW + 20 * MINUTE,
			bound: 'idle',
			asked_ms: NOW - 3 * MINUTE,
		}
		const activity = { last_event_ms: NOW, idle, is_stopped: false }
		const lines = lines_of(header({ activity }))

		expect(lines[0]).toContain(WORDS.idle_drained)
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
			`backlogrun ランなし · 更新 ${clock_of(NOW)}`,
		])
	})
})

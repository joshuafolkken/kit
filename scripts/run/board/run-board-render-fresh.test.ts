import { stripVTControlCharacters } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_board_fresh } from './run-board-fresh'
import type { BoardHeader } from './run-board-header'
import { run_board_labels } from './run-board-labels'
import type { BoardRow } from './run-board-layout'
import { run_board_render } from './run-board-render'
import { run_board_render_fixture } from './run-board-render-fixture'
import type { LaneUsages } from './run-board-usage'
import { run_board_usage_text } from './run-board-usage-text'

// joshuafolkken/kit#3784: an issue row's part that just changed — the phase it entered, the time it
// started counting, the finish time it ended at — is emphasized for about three seconds, as the
// header's are, and nothing else on the row is.

const { EMPTY_LAYOUT, NOW, header } = run_board_render_fixture
const { PHASE_ICONS, STATE_ICONS, span_of } = run_board_labels
const { paint } = run_board_fresh
const SECOND = 1000
const GB = 1024 * 1024 * 1024
const ENDED = NOW - 2 * SECOND
// A settled row that started inside the fresh window, so only the running-row guard keeps its time plain.
const SETTLED_START = ENDED - SECOND / 2
const usages: LaneUsages = new Map([[1, { cpu_percent: 20, memory_bytes: GB, memory_percent: 5 }]])

function row(number: number, state: BoardRow['state'], status: BoardRow['status']): BoardRow {
	return { number, title: `Issue ${String(number)}`, kind: undefined, state, status, waits: [] }
}

const ROWS: ReadonlyArray<BoardRow> = [
	row(1, 'running', {
		state: 'running',
		started_ms: NOW,
		track: ['investigate', 'implement'],
		phase_ms: NOW - SECOND,
	}),
	row(2, 'merged', {
		state: 'merged',
		started_ms: SETTLED_START,
		ended_ms: ENDED,
		phase_ms: ENDED,
	}),
]

function raw_lines(extra: Partial<BoardHeader> = {}): Array<string> {
	const layout = { ...EMPTY_LAYOUT, active: [...ROWS] }

	return run_board_render.render({
		header: header({ layout, usages, spinner: '⠙', ...extra }),
		notes: [],
	})
}

function row_of(lines: ReadonlyArray<string>, title: string): string {
	return lines.find((line) => stripVTControlCharacters(line).includes(title)) ?? ''
}

describe('run_board_render.render fresh rows', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it('emphasizes a running row by its start and its phase, each by its own age', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const running = row_of(raw_lines(), 'Issue 1')

		expect(running).toContain(paint('0″', 'inverse'))
		expect(running).toContain(paint(PHASE_ICONS.implement, 'bold-color'))
	})

	it('emphasizes a settled row by its finish time alone', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const merged = row_of(raw_lines(), 'Issue 2')
		const finish = run_board_usage_text.finish_of(ENDED, NOW) ?? ''

		expect(merged).toContain(paint(finish, 'bold'))
		expect(merged).toContain(`${STATE_ICONS.merged} 2`)
		expect(merged).not.toContain(paint(span_of(ENDED - SETTLED_START), 'bold'))
	})

	it('draws no emphasis in a chat, and the same columns as a live screen', () => {
		vi.stubEnv('FORCE_COLOR', '1')
		const chat = raw_lines({ form: 'chat' })
		const plain = chat.map((line) => stripVTControlCharacters(line))

		expect(row_of(chat, 'Issue 1')).not.toContain(paint('0″', 'inverse'))
		expect(raw_lines().map((line) => stripVTControlCharacters(line))).toStrictEqual(plain)
	})
})

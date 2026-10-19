import { describe, expect, it } from 'vitest'
import type { BoardRow } from './run-board-layout'
import { run_board_render_fixture } from './run-board-render-fixture'

// joshuafolkken/kit#4217: the finish-time column is drawn on a settled row only — a running row's
// tail follows its time two blanks on, however wide another row's finish time makes the column.

const { EMPTY_LAYOUT, GB, MINUTE, NOW, board_usage, header, lines_of } = run_board_render_fixture
const OTHER_DAY = Date.parse('2026-10-06T14:05:00Z')
const TAIL_AFTER_TIME = /\d″ {2}👀 /u
const FINISH_AFTER_TIME = /\d″ {2}🔚 \d+\/\d+ \d{2}:\d{2}$/u

function running(number: number, title: string): BoardRow {
	const status = {
		state: 'running' as const,
		started_ms: NOW - number * MINUTE,
		track: ['implement' as const, 'review' as const],
		phase_ms: NOW - number * MINUTE,
	}

	return { number, title, kind: undefined, state: 'running', status, waits: [] }
}

function merged(number: number, title: string): BoardRow {
	const status = {
		state: 'merged' as const,
		started_ms: OTHER_DAY - MINUTE,
		ended_ms: OTHER_DAY,
		phase_ms: OTHER_DAY,
	}

	return { number, title, kind: undefined, state: 'merged', status, waits: [] }
}

function frame_lines(): Array<string> {
	const active = [running(1, 'Short'), running(125, 'Long'), merged(2, 'Settled')]

	const usages = board_usage(
		new Map([[1, { cpu_cores: 0.1, memory_bytes: GB, compressed_bytes: 0 }]]),
	)

	return lines_of(header({ layout: { ...EMPTY_LAYOUT, active }, usages }))
}

function line_of(lines: ReadonlyArray<string>, title: string): string {
	return lines.find((line) => line.includes(title)) ?? ''
}

describe('run_board_render — the finish-time column beside a running row', () => {
	it('starts a running row’s tail one gap after its time though another row finished on another day', () => {
		const lines = frame_lines()

		expect(line_of(lines, 'Short')).toMatch(TAIL_AFTER_TIME)
		expect(line_of(lines, 'Long')).toMatch(TAIL_AFTER_TIME)
	})

	it('draws a settled row’s finish time after its time', () => {
		expect(line_of(frame_lines(), 'Settled')).toMatch(FINISH_AFTER_TIME)
	})

	it('keeps every running row’s phase icon in one column', () => {
		const lines = frame_lines()

		expect(line_of(lines, 'Short').indexOf('👀')).toBe(line_of(lines, 'Long').indexOf('👀'))
	})
})

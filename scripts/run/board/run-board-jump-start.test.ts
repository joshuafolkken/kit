import { issue_cite } from '#scripts/issue/issue-cite'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Notice } from './run-board-header-notice'
import { run_board_jump } from './run-board-jump'
import { run_board_jump_start, type JumpFrame } from './run-board-jump-start'
import type { CueName } from './run-board-sound-cues'
import { run_board_type_rows } from './run-board-type-rows'

const { arrive_of, jump_of } = run_board_jump_start
const { TICK_MS, WASH_TICKS, THAW_TICKS, THAW_AT } = run_board_jump

const ISSUE = 8677
const NOW = 1000
const NOTICE_TEXT = ' merged '
const LANE_ROW = 4
const LINES = ['header', 'one', 'two', 'three', `lane ${issue_cite.plain_for('program', ISSUE)}`]

function notice_of(cue: CueName): Notice {
	return { cause: { cue, word: 'merged', issue: ISSUE }, is_repeat: false, at_ms: NOW }
}

function frame_of(overrides: Partial<JumpFrame> = {}): JumpFrame {
	return {
		ports: { theme: 'bttf', is_tty: true },
		notice: notice_of('lane-end'),
		turn: { trace: { key: 'k', start_ms: NOW }, place: { row: 1, column: 1, text: NOTICE_TEXT } },
		drawn: { lines: LINES, spots: [], size: undefined },
		typing: run_board_type_rows.NO_TYPING,
		area: undefined,
		now_ms: NOW,
		...overrides,
	}
}

beforeEach(() => {
	vi.stubEnv('FORCE_COLOR', '3')
})

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('run_board_jump_start.jump_of', () => {
	it('starts on the first letter of a lane-end notice, on the merging lane', () => {
		const draw = jump_of(undefined, frame_of())

		expect(draw?.run.start_ms).toBe(NOW)
		expect(draw?.run.issue).toBe(ISSUE)
		expect(draw?.scene.lane).toBe(LANE_ROW)
	})

	it('starts on no other cue, nor after the first letter', () => {
		const launch = frame_of({ notice: notice_of('launch') })

		expect(jump_of(undefined, launch)).toBeUndefined()
		expect(jump_of(undefined, frame_of({ now_ms: NOW + TICK_MS }))).toBeUndefined()
	})

	it('starts in no other theme, nor off a color terminal', () => {
		expect(
			jump_of(undefined, frame_of({ ports: { theme: 'matrix', is_tty: true } })),
		).toBeUndefined()
		expect(
			jump_of(undefined, frame_of({ ports: { theme: 'bttf', is_tty: false } })),
		).toBeUndefined()
		vi.stubEnv('FORCE_COLOR', '0')
		expect(jump_of(undefined, frame_of())).toBeUndefined()
	})
})

describe('run_board_jump_start.jump_of once running', () => {
	it('carries the running jump rather than restarting it on the next merge notice', () => {
		const first = jump_of(undefined, frame_of())
		const later = NOW + TICK_MS * 2
		const next = frame_of({
			now_ms: later,
			turn: {
				trace: { key: 'k2', start_ms: later },
				place: { row: 1, column: 1, text: NOTICE_TEXT },
			},
		})

		expect(jump_of(first, next)?.run.start_ms).toBe(NOW)
	})

	it('draws nothing once the jump is over', () => {
		const first = jump_of(undefined, frame_of())
		const letters = first?.run.letters ?? 0
		const over = NOW + (letters + WASH_TICKS + THAW_TICKS) * TICK_MS

		expect(jump_of(first, frame_of({ now_ms: over }))).toBeUndefined()
	})
})

describe('run_board_jump_start.arrive_of', () => {
	const area = { top: 1, end: 2, rows: 2, lamps: [] }
	const live = { theme: 'bttf' as const, is_tty: true, opened_ms: 0 }

	it('starts the arrival at its thaw on a live bttf board first drawing its area', () => {
		const started = arrive_of(undefined, frame_of({ ports: live, area }))

		expect(started).toBe(NOW - THAW_AT * TICK_MS)
	})

	it('keeps the arrival once it is set', () => {
		const later = frame_of({ ports: live, area, now_ms: NOW + TICK_MS })

		expect(arrive_of(NOW, later)).toBe(NOW)
		expect(arrive_of(NOW, frame_of())).toBe(NOW)
	})

	it('starts no arrival without the area, off a live board, or in another theme', () => {
		expect(arrive_of(undefined, frame_of({ ports: live }))).toBeUndefined()
		expect(arrive_of(undefined, frame_of({ area }))).toBeUndefined()
		const matrix = { ...live, theme: 'matrix' as const }

		expect(arrive_of(undefined, frame_of({ ports: matrix, area }))).toBeUndefined()
	})
})

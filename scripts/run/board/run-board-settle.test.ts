import { describe, expect, it } from 'vitest'
import { run_board_settle } from './run-board-settle'
import type { ItemStatus } from './run-board-status'

const STARTED_MS = 1000
const LAUNCHED_MS = 3000

describe('run_board_settle.settled_as', () => {
	it('keeps the start, the newest launch, the spans and the track', () => {
		const spans = [{ from_ms: STARTED_MS, end_ms: undefined }]
		const running: ItemStatus = {
			state: 'running',
			started_ms: STARTED_MS,
			launched_ms: LAUNCHED_MS,
			spans,
			track: ['investigate'],
			lane: 'lane 1',
			phase_ms: LAUNCHED_MS,
		}

		expect(run_board_settle.settled_as(running, 'merged')).toStrictEqual({
			state: 'merged',
			started_ms: STARTED_MS,
			launched_ms: LAUNCHED_MS,
			spans,
			track: ['investigate'],
		})
	})

	it('settles a child the stream never held with no start', () => {
		expect(run_board_settle.settled_as(undefined, 'done')).toStrictEqual({
			state: 'done',
			started_ms: undefined,
		})
	})
})

describe('run_board_settle.relaunch_of', () => {
	it('carries only a launch after the first', () => {
		expect(run_board_settle.relaunch_of({ state: 'running' })).toStrictEqual({})
		expect(
			run_board_settle.relaunch_of({ state: 'running', launched_ms: LAUNCHED_MS }),
		).toStrictEqual({ launched_ms: LAUNCHED_MS })
	})
})

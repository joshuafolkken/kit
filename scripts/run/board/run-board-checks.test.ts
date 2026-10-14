import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { run_board_checks } from './run-board-checks'

// joshuafolkken/kit#3770: the board reads each child's newest `pr-checks` line from the stream alone.

function event(text: string, at: string, kind = 'pr-checks'): RunEvent {
	return { pos: 0, at, kind, text }
}

const OLDER = event(
	'#3754 PR 3765 pass 4 pending 4 fail 0 coderabbit running',
	'2026-10-14T03:00:00Z',
)
const NEWER = event('#3754 PR 3765 pass 8 pending 0 fail 0 coderabbit done', '2026-10-14T03:05:00Z')

describe('run_board_checks.newest_of', () => {
	it('keeps each child’s newest checks by their time, whatever the order of the lines', () => {
		const newest = run_board_checks.newest_of([NEWER, OLDER])

		expect(newest.get(3754)).toStrictEqual({
			pr: 3765,
			pass: 8,
			pending: 0,
			fail: 0,
			coderabbit: 'done',
		})
	})

	it('reads no other kind and no line of another shape', () => {
		const events = [event(NEWER.text, NEWER.at, 'note'), event('#3754 broken', NEWER.at)]

		expect(run_board_checks.newest_of(events).size).toBe(0)
	})
})

import { describe, expect, it } from 'vitest'
import { run_board_released } from './run-board-released'
import type { ItemStatus } from './run-board-status'

const { without_released } = run_board_released
const ISSUE = 4067
const PARKED_MS = 1000
const PARKED: ItemStatus = { state: 'parked', started_ms: 0, ended_ms: PARKED_MS }
const UNDECIDED = new Map([[ISSUE, ['auto-ok']]])

function kept(
	status: ItemStatus,
	read_ms: number | undefined,
	labels: ReadonlyMap<number, ReadonlyArray<string>> = UNDECIDED,
): boolean {
	return without_released(new Map([[ISSUE, status]]), { read_ms, labels }).has(ISSUE)
}

describe('run_board_released.without_released', () => {
	it('drops a parked child read open without needs-decision after its park', () => {
		expect(kept(PARKED, PARKED_MS + 1)).toBe(false)
	})

	it.each<[string, ItemStatus, number | undefined, ReadonlyMap<number, Array<string>>]>([
		['the listing was read before the park', PARKED, PARKED_MS - 1, UNDECIDED],
		['the listing has not been read', PARKED, undefined, UNDECIDED],
		['the listing does not hold it', PARKED, PARKED_MS + 1, new Map()],
		[
			'it still carries needs-decision',
			PARKED,
			PARKED_MS + 1,
			new Map([[ISSUE, ['needs-decision']]]),
		],
		['it still carries run:stalled', PARKED, PARKED_MS + 1, new Map([[ISSUE, ['run:stalled']]])],
		['it carries already-done', PARKED, PARKED_MS + 1, new Map([[ISSUE, ['already-done']]])],
		['it is not parked', { ...PARKED, state: 'stopped' }, PARKED_MS + 1, UNDECIDED],
	])('keeps the child when %s', (_label, status, read_ms, labels) => {
		expect(kept(status, read_ms, labels)).toBe(true)
	})
})

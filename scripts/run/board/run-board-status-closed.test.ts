import { describe, expect, it } from 'vitest'
import type { ClosedIssue } from './run-board-closed'
import { run_board_status, type ItemStatus, type OpenRead } from './run-board-status'

// joshuafolkken/kit#3451: a child read closed from GitHub ends when it closed, merged or not.
// joshuafolkken/kit#3958: a parked child a person closed afterwards is settled again by that read.

const T0 = Date.parse('2026-10-08T09:00:00.000Z')
const T1 = Date.parse('2026-10-08T09:05:00.000Z')
const T2 = Date.parse('2026-10-08T09:10:00.000Z')
const ISSUE = 3409
const NO_LABELS: ReadonlyMap<number, ReadonlyArray<string>> = new Map()

function statuses(state: ItemStatus['state']): ReadonlyMap<number, ItemStatus> {
	return new Map([[ISSUE, { state, started_ms: T0 }]])
}

function closed_issue(overrides: Partial<ClosedIssue>): ClosedIssue {
	return {
		title: 'Fix',
		labels: [],
		closed_ms: T2,
		is_merged: false,
		is_not_planned: false,
		...overrides,
	}
}

// An open listing read after the launch that no longer holds the child, with its closed read.
function read_closed(closed: ClosedIssue | undefined): OpenRead {
	return {
		open_numbers: new Set(),
		read_ms: T1,
		closed: closed === undefined ? new Map() : new Map([[ISSUE, closed]]),
		labels: NO_LABELS,
	}
}

function settle(state: ItemStatus['state'], read: OpenRead): ItemStatus | undefined {
	return run_board_status.settle_closed(statuses(state), read).get(ISSUE)
}

function settle_read_closed(
	state: ItemStatus['state'],
	closed: Partial<ClosedIssue>,
): ItemStatus | undefined {
	return settle(state, read_closed(closed_issue(closed)))
}

describe('run_board_status.settle_closed with a closed read', () => {
	it.each<[string, Partial<ClosedIssue>]>([
		['merged', { is_merged: true }],
		['withdrawn', { is_not_planned: true }],
		['done', {}],
	])('draws a running child read closed as %s, timed to its close', (state, closed) => {
		expect(settle_read_closed('running', closed)).toStrictEqual({
			state,
			started_ms: T0,
			ended_ms: T2,
		})
	})

	it('ignores a close dated before the launch', () => {
		const read = read_closed(closed_issue({ closed_ms: T0 - 1, is_merged: true }))

		expect(settle('running', read)).toStrictEqual({ state: 'done', started_ms: T0 })
	})
})

describe('run_board_status.settle_closed with a parked child', () => {
	it.each<[string, Partial<ClosedIssue>]>([
		['withdrawn', { is_not_planned: true }],
		['merged', { is_merged: true }],
	])('draws a parked child read closed as %s, timed to its close', (state, closed) => {
		expect(settle_read_closed('parked', closed)).toStrictEqual({
			state,
			started_ms: T0,
			ended_ms: T2,
		})
	})

	it('draws one whose close time could not be read without a time', () => {
		const read = read_closed(closed_issue({ closed_ms: undefined, is_not_planned: true }))

		expect(settle('parked', read)).toStrictEqual({
			state: 'withdrawn',
			started_ms: T0,
			ended_ms: undefined,
		})
	})

	it.each<[string, OpenRead]>([
		['not read closed though gone from the listing', read_closed(undefined)],
		[
			'still open and labelled with no in-progress',
			{ open_numbers: new Set([ISSUE]), read_ms: T1, closed: new Map(), labels: NO_LABELS },
		],
	])('keeps a parked child parked when it is %s', (_label, read) => {
		expect(settle('parked', read)).toStrictEqual({ state: 'parked', started_ms: T0 })
	})
})

describe('run_board_status.settle_closed with a parked child reopened', () => {
	it('keeps one parked once the listing holds it again after its closed read', () => {
		const read = read_closed(closed_issue({ is_not_planned: true }))

		expect(settle('parked', { ...read, open_numbers: new Set([ISSUE]) })).toStrictEqual({
			state: 'parked',
			started_ms: T0,
		})
	})
})

import { ALREADY_DONE_LABEL } from '#scripts/issue/issue-labels'
import { run_event_stream, type RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import type { ClosedIssue } from './run-board-closed'
import { run_board_status, type ItemStatus, type OpenRead } from './run-board-status'

// joshuafolkken/kit#3451: a child read closed from GitHub ends when it closed, merged or not.
// joshuafolkken/kit#3958: a parked child a person closed afterwards is settled again by that read.
// joshuafolkken/kit#6891: so is a child stopped for human review that a person merged.

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

// An open listing read after the launch that still holds the child, with its labels.
function read_open(labels: ReadonlyArray<string>): OpenRead {
	return {
		open_numbers: new Set([ISSUE]),
		read_ms: T1,
		closed: new Map(),
		labels: new Map([[ISSUE, labels]]),
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

	// joshuafolkken/kit#4537: nor does its absence from the open listing settle it.
	it('ignores a close dated before the launch', () => {
		const read = read_closed(closed_issue({ closed_ms: T0 - 1, is_merged: true }))

		expect(settle('running', read)).toStrictEqual({ state: 'running', started_ms: T0 })
	})
})

describe('run_board_status.settle_closed with a parked child', () => {
	it.each<[string, Partial<ClosedIssue>]>([
		['withdrawn', { is_not_planned: true }],
		['merged', { is_merged: true }],
		// joshuafolkken/kit#7095 (ac-38bbacca): closed by `josh issue:already-done`, its label kept.
		['already_done', { labels: [ALREADY_DONE_LABEL] }],
		['done', {}],
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
		['still open and labelled with no in-progress', read_open([])],
		// joshuafolkken/kit#7095 (ac-b055a6a2): the label alone, on an open issue, settles nothing.
		['still open and labelled already-done', read_open([ALREADY_DONE_LABEL])],
	])('keeps a parked child parked when it is %s', (_label, read) => {
		expect(settle('parked', read)).toStrictEqual({ state: 'parked', started_ms: T0 })
	})
})

describe('run_board_status.settle_closed with a parked child reopened', () => {
	it('keeps one parked once a listing read after its close holds it again', () => {
		const read = read_closed(closed_issue({ is_not_planned: true }))
		const after_close = { ...read, open_numbers: new Set([ISSUE]), read_ms: T2 + 1 }

		expect(settle('parked', after_close)).toStrictEqual({ state: 'parked', started_ms: T0 })
	})

	// joshuafolkken/kit#6535: the listing an ended run holds was read before the close.
	it('settles one a listing read before its close still holds', () => {
		const read = read_closed(closed_issue({ is_not_planned: true }))

		expect(settle('parked', { ...read, open_numbers: new Set([ISSUE]) })).toStrictEqual({
			state: 'withdrawn',
			started_ms: T0,
			ended_ms: T2,
		})
	})

	// A close from before a relaunch belongs to the issue's earlier life, whatever the listing holds.
	it('keeps one parked again after a relaunch past its earlier close', () => {
		const relaunched = new Map([[ISSUE, { state: 'parked' as const, started_ms: T2 + 1 }]])
		const read = { ...read_closed(closed_issue({ is_not_planned: true })), open_numbers: undefined }

		expect(run_board_status.settle_closed(relaunched, read).get(ISSUE)).toStrictEqual({
			state: 'parked',
			started_ms: T2 + 1,
		})
	})
})

const KIND = run_event_stream.EVENT_KIND

function event_of(pos: number, at_ms: number, kind: string): RunEvent {
	return { pos, at: new Date(at_ms).toISOString(), kind, text: `#${String(ISSUE)}` }
}

// A child launched at T0 that stopped for human review at T1, as the event stream draws it.
const HUMAN_REVIEWED = run_board_status.fold_events([
	event_of(1, T0, KIND.CHILD_LAUNCH),
	event_of(2, T1, KIND.HUMAN_REVIEW),
])

function settle_human(read: OpenRead): ItemStatus | undefined {
	return run_board_status.settle_closed(HUMAN_REVIEWED, read).get(ISSUE)
}

describe('run_board_status.settle_closed with a child stopped for human review', () => {
	it('folds the human-review event into a human child', () => {
		expect(HUMAN_REVIEWED.get(ISSUE)).toMatchObject({ state: 'human', started_ms: T0 })
	})

	it('draws one a person merged as merged, timed to its close', () => {
		const read = read_closed(closed_issue({ is_merged: true }))

		expect(settle_human(read)).toMatchObject({ state: 'merged', started_ms: T0, ended_ms: T2 })
	})

	it('keeps one human once a listing read after its close holds it again', () => {
		const read = read_closed(closed_issue({ is_merged: true }))

		expect(
			settle_human({ ...read, open_numbers: new Set([ISSUE]), read_ms: T2 + 1 }),
		).toMatchObject({ state: 'human' })
	})

	it('keeps one human when its close is dated before the launch', () => {
		const read = read_closed(closed_issue({ closed_ms: T0 - 1, is_merged: true }))

		expect(settle_human(read)).toMatchObject({ state: 'human' })
	})
})

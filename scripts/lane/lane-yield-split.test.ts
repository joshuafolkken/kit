import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import type { LedgerEntry } from './lane-ledger'
import { lane_yield_split } from './lane-yield-split'

// joshuafolkken/kit#5984. The #5953 yield of 2026-11-03: its holder #5943 merged after the note, and
// the issue was dispatched again after that merge — the instants the issue records.

const YIELDER = 5953
const HOLDER = 5943
const URL = 'https://github.com/joshuafolkken/kit/issues'
const MS_PER_MINUTE = 60_000
const YIELD_AT = '2026-11-03T17:56:00.000Z'
const MERGED_AT = '2026-11-03T18:19:00.000Z'
const OPENED_AT = '2026-11-03T18:31:00.000Z'
const DISPATCHED_AT = '2026-11-03T18:33:00.000Z'

function cited(issue: number): string {
	return `[#${String(issue)}](${URL}/${String(issue)})`
}

function yield_note(holder?: number): RunEvent {
	const which = holder === undefined ? '' : `, which ${cited(holder)} declares or plans`

	return {
		pos: 0,
		at: YIELD_AT,
		kind: 'note',
		text: `#${String(YIELDER)} yielded its lane: ${cited(YIELDER)}'s planned \`a.ts\` overlaps \`a.ts\`${which} · at: summary`,
	}
}

function opening(issue: number): RunEvent {
	return { pos: 0, at: OPENED_AT, kind: 'setup', text: `opening lane #${String(issue)}` }
}

const MERGE: LedgerEntry = { kind: 'merge', at: MERGED_AT, issue: HOLDER }
const DISPATCH: LedgerEntry = { kind: 'dispatch', at: DISPATCHED_AT, issue: YIELDER }

function minutes(span: { from_ms: number; end_ms: number | undefined } | undefined): number {
	return span?.end_ms === undefined ? NaN : (span.end_ms - span.from_ms) / MS_PER_MINUTE
}

describe('lane_yield_split.parts', () => {
	it('splits the #5953 wait at its holder merge and its lane opening', () => {
		const [part] = lane_yield_split.parts([MERGE, DISPATCH], [yield_note(HOLDER), opening(YIELDER)])

		expect(
			[part?.wait, part?.holder, part?.offer, part?.launch].map((span) => minutes(span)),
		).toStrictEqual([37, 23, 12, 2])
	})

	it('leaves a note naming no holder unsplit, its wait whole', () => {
		const [part] = lane_yield_split.parts([MERGE, DISPATCH], [yield_note()])

		expect(part?.holder).toBeUndefined()
		expect(minutes(part?.wait)).toBe(37)
	})
})

describe('lane_yield_split.parts -- the holder end', () => {
	it('ends the holder part at a withdrawal of the holder', () => {
		const withdraw: RunEvent = {
			pos: 0,
			at: MERGED_AT,
			kind: 'withdraw',
			text: `#${String(HOLDER)} withdrawn by a person: stale`,
		}
		const [part] = lane_yield_split.parts([DISPATCH], [yield_note(HOLDER), withdraw])

		expect(minutes(part?.holder)).toBe(23)
	})

	it('ends the holder part at a human-review hand-back of the holder', () => {
		const human_review: RunEvent = {
			pos: 0,
			at: MERGED_AT,
			kind: 'human-review',
			text: `#${String(HOLDER)} needs human review`,
		}
		const events = [yield_note(HOLDER), human_review, opening(YIELDER)]
		const [part] = lane_yield_split.parts([DISPATCH], events)

		expect([part?.holder, part?.offer, part?.launch].map((span) => minutes(span))).toStrictEqual([
			23, 12, 2,
		])
	})
})

describe('lane_yield_split.parts -- the parts not ended', () => {
	it('ends the holder part at the redispatch when the holder had not ended by then', () => {
		const [part] = lane_yield_split.parts([DISPATCH], [yield_note(HOLDER), opening(YIELDER)])

		expect(minutes(part?.holder)).toBe(37)
		expect(part?.offer).toBeUndefined()
		expect(part?.launch).toBeUndefined()
	})

	it('leaves the holder part not ended and no later part while the holder runs', () => {
		const [part] = lane_yield_split.parts([], [yield_note(HOLDER)])

		expect(part?.holder?.end_ms).toBeUndefined()
		expect(part?.offer).toBeUndefined()
		expect(part?.launch).toBeUndefined()
	})

	it('leaves the offer part not ended when no lane opened for the yielder', () => {
		const [part] = lane_yield_split.parts([MERGE, DISPATCH], [yield_note(HOLDER), opening(HOLDER)])

		expect(minutes(part?.holder)).toBe(23)
		expect(part?.offer?.end_ms).toBeUndefined()
		expect(part?.launch).toBeUndefined()
	})
})

describe('lane_yield_split.of_issue', () => {
	it('names the #5953 holder and its 14-minute redispatch gap', () => {
		const events = [yield_note(HOLDER), opening(YIELDER)]

		expect(lane_yield_split.of_issue([MERGE, DISPATCH], events, YIELDER)).toStrictEqual([
			{ holder: HOLDER, gap_ms: 14 * MS_PER_MINUTE, is_early: false },
		])
	})

	it('leaves the gap unknown while the holder runs, and skips another issue', () => {
		const events = [yield_note(HOLDER)]

		expect(lane_yield_split.of_issue([], events, YIELDER)).toStrictEqual([
			{ holder: HOLDER, gap_ms: undefined, is_early: false },
		])
		expect(lane_yield_split.of_issue([], events, HOLDER)).toStrictEqual([])
	})
})

// joshuafolkken/kit#6006: `lane:breakdown` prints the #5953 wait as its holder part and its gap.
describe('lane_yield_split.issue_parts and share_of', () => {
	it('sums the #5953 holder part and its offer and launch parts', () => {
		const events = [yield_note(HOLDER), opening(YIELDER)]
		const splits = lane_yield_split.issue_parts([MERGE, DISPATCH], events, YIELDER)

		expect(lane_yield_split.share_of(splits)).toStrictEqual({
			holder_ms: 23 * MS_PER_MINUTE,
			gap_ms: 14 * MS_PER_MINUTE,
			unsplit_ms: 0,
		})
		expect(lane_yield_split.issue_parts([MERGE, DISPATCH], events, HOLDER)).toStrictEqual([])
	})

	it('counts no part that has not ended', () => {
		const splits = lane_yield_split.issue_parts([], [yield_note(HOLDER)], YIELDER)

		expect(lane_yield_split.share_of(splits)).toStrictEqual({
			holder_ms: 0,
			gap_ms: 0,
			unsplit_ms: 0,
		})
	})

	it('counts the wait of a note naming no holder as unsplit', () => {
		const splits = lane_yield_split.issue_parts([MERGE, DISPATCH], [yield_note()], YIELDER)

		expect(lane_yield_split.share_of(splits)).toStrictEqual({
			holder_ms: 0,
			gap_ms: 0,
			unsplit_ms: 37 * MS_PER_MINUTE,
		})
	})
})

describe('lane_yield_split.of_issue -- a redispatch the split does not reach', () => {
	it('marks a redispatch before the holder ended as early, with no gap', () => {
		expect(lane_yield_split.of_issue([DISPATCH], [yield_note(HOLDER)], YIELDER)).toStrictEqual([
			{ holder: HOLDER, gap_ms: undefined, is_early: true },
		])
	})

	it('reads the gap from the redispatch when the stream lacks the lane opening', () => {
		const taken = lane_yield_split.of_issue([MERGE, DISPATCH], [yield_note(HOLDER)], YIELDER)

		expect(taken).toStrictEqual([{ holder: HOLDER, gap_ms: 14 * MS_PER_MINUTE, is_early: false }])
	})

	it('marks a note naming no holder neither early nor gapped', () => {
		expect(lane_yield_split.of_issue([MERGE, DISPATCH], [yield_note()], YIELDER)).toStrictEqual([
			{ holder: undefined, gap_ms: undefined, is_early: false },
		])
	})
})

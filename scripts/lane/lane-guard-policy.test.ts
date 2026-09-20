import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lane_guard_policy } from './lane-guard-policy'

// joshuafolkken/kit#2138, joshuafolkken/kit#2164: the enumeration that decides how each `PreToolUse`
// guard behaves in a dispatched lane child. What is pinned here is the policy itself — the per-guard
// three-valued mode (`refuse` / `notice` / `off`), the fail-safe default, and that a mode other than the
// main-line default is read only for a real lane child. Each guard's own suite pins that its live
// behavior matches the mode named here (`investigation-guard.test.ts`, `batch-guard.test.ts`,
// `delivered-rules.test.ts`), so the enumeration and the guards cannot disagree.

const LANE_ISSUE = '2138'
// A lane checkout path — `<root>/.kit-lanes/<issue>` — built as a string only: `is_child_of` reads the
// path and the mark, never the filesystem, so nothing here is created on disk.
const BASE_DIRECTORY = path.join('/tmp', 'lane-guard-policy')
const LANE_DIRECTORY = path.join(BASE_DIRECTORY, '.kit-lanes', LANE_ISSUE)
const PLAIN_DIRECTORY = path.join(BASE_DIRECTORY, 'checkout')
const LANE_CHILD_SOURCE = { JOSH_LANE_CHILD: LANE_ISSUE }
const NO_MARK_SOURCE = {}

describe('lane_guard_policy.mode_in_lane_child', () => {
	it.each([
		['investigation', 'off'],
		['batching', 'notice'],
		['rule', 'refuse'],
	])('says %j behaves as %s in a lane child', (id, mode) => {
		expect(lane_guard_policy.mode_in_lane_child(id)).toBe(mode)
	})

	// The fail-safe direction `delegation-policy.ts` takes: a guard nobody classified keeps the
	// main-line default (`refuse`), so a silent downgrade is never possible.
	it('refuses for a guard that is not enumerated', () => {
		expect(lane_guard_policy.mode_in_lane_child('unlisted-guard')).toBe('refuse')
	})

	// The enumeration may only ever name one of the three known modes — a fourth spelling is a typo the
	// wrappers would read as neither `refuse` nor `notice` nor `off`, so it is caught here.
	it('gives every row one of the three known modes', () => {
		for (const entry of lane_guard_policy.LANE_GUARD_POLICY) {
			expect(['refuse', 'notice', 'off']).toContain(entry.mode_in_lane_child)
		}
	})
})

describe('lane_guard_policy — the enumeration is the whole of it', () => {
	// Every guard the guards themselves consult is named here, and nothing else — a guard added without a
	// row, or a row for a guard nobody consults, is caught here rather than shipping a silent suppression.
	it('enumerates exactly the three PreToolUse guards', () => {
		const sorted = [...lane_guard_policy.KNOWN_GUARD_IDS].toSorted((left, right) =>
			left.localeCompare(right),
		)

		expect(sorted).toEqual(['batching', 'investigation', 'rule'])
	})

	it('gives every row a reason', () => {
		for (const entry of lane_guard_policy.LANE_GUARD_POLICY) {
			expect(entry.because.length).toBeGreaterThan(0)
		}
	})
})

describe('lane_guard_policy.mode_here', () => {
	// In a marked lane child every guard takes its enumerated mode — this is the table the wrappers read.
	it.each([
		['investigation', 'off'],
		['batching', 'notice'],
		['rule', 'refuse'],
	])('gives %j its enumerated mode %s in a marked lane child', (id, mode) => {
		expect(lane_guard_policy.mode_here(id, LANE_DIRECTORY, LANE_CHILD_SOURCE)).toBe(mode)
	})

	// No mark: a person working in a lane sees every guard refuse, exactly as the main line does.
	it.each([['investigation'], ['batching'], ['rule']])(
		'gives %j the main-line default without the lane-child mark',
		(id) => {
			expect(lane_guard_policy.mode_here(id, LANE_DIRECTORY, NO_MARK_SOURCE)).toBe('refuse')
		},
	)

	// A mark carried into a checkout that is not a lane is read as a person's, not a child's.
	it('gives the main-line default outside a lane checkout', () => {
		expect(lane_guard_policy.mode_here('batching', PLAIN_DIRECTORY, LANE_CHILD_SOURCE)).toBe(
			'refuse',
		)
	})
})

describe('lane_guard_policy.is_suppressed_here', () => {
	// `is_suppressed_here` is the `off` mode alone — the guard says nothing at all.
	it('suppresses an off-mode guard in a marked lane child', () => {
		expect(
			lane_guard_policy.is_suppressed_here('investigation', LANE_DIRECTORY, LANE_CHILD_SOURCE),
		).toBe(true)
	})

	// **A notice-mode guard is not suppressed**: it still speaks, without a `permissionDecision`. This is
	// the distinction kit#2164 turns on — read as suppressed, the batching guard would go silent in the
	// lane child instead of notifying.
	it('does not suppress a notice-mode guard in a marked lane child', () => {
		expect(
			lane_guard_policy.is_suppressed_here('batching', LANE_DIRECTORY, LANE_CHILD_SOURCE),
		).toBe(false)
	})

	it('never suppresses a refuse-mode guard in a lane child', () => {
		expect(lane_guard_policy.is_suppressed_here('rule', LANE_DIRECTORY, LANE_CHILD_SOURCE)).toBe(
			false,
		)
	})

	// No mark, no suppression — a person working in a lane sees every guard.
	it('suppresses nothing without the lane-child mark', () => {
		expect(
			lane_guard_policy.is_suppressed_here('investigation', LANE_DIRECTORY, NO_MARK_SOURCE),
		).toBe(false)
	})

	// A mark carried into a checkout that is not a lane is read as a person's, not a child's.
	it('suppresses nothing outside a lane checkout', () => {
		expect(
			lane_guard_policy.is_suppressed_here('investigation', PLAIN_DIRECTORY, LANE_CHILD_SOURCE),
		).toBe(false)
	})
})

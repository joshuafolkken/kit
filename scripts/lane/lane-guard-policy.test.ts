import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { lane_guard_policy } from './lane-guard-policy'

// joshuafolkken/kit#2138: the enumeration that decides which `PreToolUse` guards fire in a dispatched
// lane child. What is pinned here is the policy itself — the per-guard verdict, the fail-safe default,
// and that a suppression is read only for a real lane child. Each guard's own suite pins that its live
// behavior matches the verdict named here (`investigation-guard.test.ts`, `batch-guard.test.ts`,
// `delivered-rules.test.ts`), so the enumeration and the guards cannot disagree.

const LANE_ISSUE = '2138'
// A lane checkout path — `<root>/.kit-lanes/<issue>` — built as a string only: `is_child_of` reads the
// path and the mark, never the filesystem, so nothing here is created on disk.
const BASE_DIRECTORY = path.join('/tmp', 'lane-guard-policy')
const LANE_DIRECTORY = path.join(BASE_DIRECTORY, '.kit-lanes', LANE_ISSUE)
const PLAIN_DIRECTORY = path.join(BASE_DIRECTORY, 'checkout')
const LANE_CHILD_SOURCE = { JOSH_LANE_CHILD: LANE_ISSUE }
const NO_MARK_SOURCE = {}

describe('lane_guard_policy.fires_in_lane_child', () => {
	it.each([
		['investigation', false],
		['batching', false],
		['rule', true],
	])('says %j fires in a lane child: %s', (id, fires) => {
		expect(lane_guard_policy.fires_in_lane_child(id)).toBe(fires)
	})

	// The fail-safe direction `delegation-policy.ts` takes: a guard nobody classified fires, so a
	// suppression is never the silent default.
	it('fires for a guard that is not enumerated', () => {
		expect(lane_guard_policy.fires_in_lane_child('unlisted-guard')).toBe(true)
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

describe('lane_guard_policy.is_suppressed_here', () => {
	// A suppressed guard stands down only where the session is a dispatched lane child for this checkout.
	it('suppresses a non-firing guard in a marked lane child', () => {
		expect(
			lane_guard_policy.is_suppressed_here('investigation', LANE_DIRECTORY, LANE_CHILD_SOURCE),
		).toBe(true)
	})

	it('never suppresses a guard that fires in a lane child', () => {
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

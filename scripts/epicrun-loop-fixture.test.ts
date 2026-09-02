import { epicrun_loop, EPICRUN_SKILL } from '#scripts/epicrun-loop-fixture'
import { describe, expect, it } from 'vitest'

// The fixture two marker suites slice the loop's per-child step with. Its own failure mode is the
// dangerous one: `indexOf` answers `-1` for a marker that is gone, and `slice(0, -1)` is the whole
// rest of the file rather than nothing — so a renumbered loop would silently turn "this rule is
// reachable by following the numbered steps" into a whole-file search, and every suite built on it
// would stay green while the rules had left the loop (joshuafolkken/kit#1212).

describe('the per-child loop slice', () => {
	it('is bounded by the step that follows it', () => {
		const step = epicrun_loop.per_child_step()

		expect(step).toContain('pnpm josh issue:state <N>')
		expect(step).not.toContain('Stopping conditions')
	})

	// The guard, exercised rather than assumed: it is what turns a renumbered loop into a failure
	// instead of a silently widened search.
	it('throws when the start marker is gone', () => {
		expect(() => epicrun_loop.slice_between('no loop here', 'start', 'end')).toThrow(EPICRUN_SKILL)
	})

	// **The end marker needs a case of its own.** Content missing *both* markers throws on the start
	// one and never executes the second guard at all — so a refactor that restored the unguarded
	// `tail.indexOf(end)`, the exact `-1` widening this fixture exists to prevent, would leave a
	// both-markers-absent suite green.
	it('throws when only the end marker is gone', () => {
		expect(() => epicrun_loop.slice_between('a start and nothing after', 'start', 'end')).toThrow(
			EPICRUN_SKILL,
		)
	})

	// `-1` is the value the unguarded version would have sliced against, so the message has to name
	// the marker that went missing rather than only reporting that something did.
	it('names the missing marker', () => {
		expect(() => epicrun_loop.slice_between('', 'absent marker', 'also absent')).toThrow(
			'"absent marker"',
		)
	})
})

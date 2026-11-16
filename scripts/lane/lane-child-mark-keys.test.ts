import { outer_command } from '#scripts/josh/outer-command'
import { lane_child_mark_keys } from '#scripts/lane/lane-child-mark-keys'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { describe, expect, it } from 'vitest'

const ISSUE = '5029'
// The prompt-cache TTL rides on a child's environment but is a provider setting, not a lane mark; the
// blanked outer command is a fresh start, not a mark (joshuafolkken/kit#7593).
const NOT_MARKS: ReadonlySet<string> = new Set(['CLAUDE_CODE_PROMPT_CACHE_TTL', outer_command.KEY])

function marks_set_by(environment: Record<string, string>): Array<string> {
	return Object.keys(environment).filter((key) => !NOT_MARKS.has(key))
}

// joshuafolkken/kit#5029: the unit suite blanks exactly these keys, so a mark a launcher sets but this
// list misses would reach a test the way the ship's retry-pending mark once did.
describe('lane_child_mark_keys — every mark a launcher sets on a child', () => {
	it('names every key the overrun launch sets, which carries the dispatch mark too', () => {
		const marks = marks_set_by(lane_child_marker.overrun_env_for(ISSUE))

		expect(lane_child_mark_keys.MARK_KEYS).toEqual(expect.arrayContaining(marks))
		expect(marks).toHaveLength(lane_child_mark_keys.MARK_KEYS.length)
	})

	it('is the source of the keys the marker reads', () => {
		expect(lane_child_marker.KEY).toBe(lane_child_mark_keys.KEY)
		expect(lane_child_marker.OVERRUN_KEY).toBe(lane_child_mark_keys.OVERRUN_KEY)
	})
})

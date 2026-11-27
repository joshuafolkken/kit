import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_park } from '#scripts/rules/lane-park'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { write_stop_decision } from './stop-guard'
import { stop_guard_fixture } from './stop-guard-fixture'

// joshuafolkken/kit#8956: the hook reads the lane child's unrecorded end into the stop context, so a
// child that hands its stop back with nothing on its Issue is sent back to park.

const { UNREAD_TRANSCRIPT, quiet_world } = stop_guard_fixture
// The refusal's opening, free of the quotes the JSON envelope escapes.
const PARK_HEADLINE = 'lane child end without a park'

// The stdout writes of one stop decision in a lane child whose end reads as `is_unrecorded`.
async function decide_lane_end(is_unrecorded: boolean): Promise<string> {
	quiet_world()
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
	vi.spyOn(lane_park, 'is_unrecorded_end').mockReturnValue(is_unrecorded)
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

	await write_stop_decision(JSON.stringify({ transcript_path: UNREAD_TRANSCRIPT }))

	return write.mock.calls.map((call) => String(call[0])).join('')
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('write_stop_decision — the lane child park is wired', () => {
	it('refuses a lane child ending with nothing on its Issue', async () => {
		expect(lane_park.LANE_STOP_PARK_REASON).toContain(PARK_HEADLINE)
		expect(await decide_lane_end(true)).toContain(PARK_HEADLINE)
	})

	it('lets a lane child whose end is recorded stop', async () => {
		expect(await decide_lane_end(false)).not.toContain(PARK_HEADLINE)
	})
})

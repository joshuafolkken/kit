import { gate_skip } from '#scripts/gate/gate-skip'
import { gate_tree } from '#scripts/gate/gate-tree'
import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import { review_stamps } from '#scripts/review/review-stamps'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_review } from './run-review'
import { run_review_steps } from './run-review-steps'

// joshuafolkken/kit#2434: the gate records green and only then clears its in-flight marker. A gate
// that finishes between the join's two reads must still read green — which holds only when the marker
// is read first. Each probe below lets the gate finish the moment the first of them has been read.
const GATE_STAMP: FileMapStamp = { taken_at: '2026-09-23T10:40:07.855Z', files: {} }

function gate_finishing_after_first_read(): void {
	let is_finished = false

	function observe(
		when_finished: FileMapStamp | undefined,
		when_running: FileMapStamp | undefined,
	): FileMapStamp | undefined {
		const seen = is_finished ? when_finished : when_running

		is_finished = true

		return seen
	}

	vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue({ files: {}, base: undefined })
	vi.spyOn(file_map_stamp, 'is_writer_running').mockImplementation((stamp) => stamp !== undefined)
	vi.spyOn(review_stamps.in_flight_stamp, 'read').mockImplementation(() =>
		observe(undefined, GATE_STAMP),
	)
	vi.spyOn(gate_skip, 'reusable_green_gate').mockImplementation(() =>
		observe(GATE_STAMP, undefined),
	)
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('read_gate_state across the gate finishing', () => {
	it('reads green, never red, when the gate records green between the two reads', async () => {
		gate_finishing_after_first_read()

		expect(await run_review_steps.read_gate_state()).toBe(run_review.GATE_GREEN)
	})
})

import { gate_skip } from '#scripts/gate/gate-skip'
import { gate_tree } from '#scripts/gate/gate-tree'
import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import { stamp_file } from '#scripts/josh/stamp-file'
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

// joshuafolkken/kit#4774: a round-1 reviewer's fix in place moved the tree after the gate passed.
const GATE_STARTED_AT = '2026-09-23T10:39:00.000Z'

function settled_gate_with_no_matching_green(stamp_taken_at: string): void {
	vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue({ files: {}, base: undefined })
	vi.spyOn(file_map_stamp, 'is_writer_running').mockReturnValue(false)
	vi.spyOn(gate_skip, 'reusable_green_gate').mockReturnValue(undefined)
	vi.spyOn(stamp_file, 'read_stamp_text').mockReturnValue(
		JSON.stringify({ gate_started_at: GATE_STARTED_AT, review_started_at: GATE_STARTED_AT }),
	)
	vi.spyOn(review_stamps.gate_stamp, 'read').mockReturnValue({
		taken_at: stamp_taken_at,
		files: {},
	})
}

describe('read_gate_state after the tree moved', () => {
	it('reads a green this gate recorded on an earlier tree as moved', async () => {
		settled_gate_with_no_matching_green(GATE_STAMP.taken_at)

		expect(await run_review_steps.read_gate_state()).toBe(run_review.GATE_MOVED)
	})

	it('reads a green an earlier run left as red, since this gate recorded none', async () => {
		settled_gate_with_no_matching_green('2026-09-23T10:00:00.000Z')

		expect(await run_review_steps.read_gate_state()).toBe(run_review.GATE_RED)
	})
})

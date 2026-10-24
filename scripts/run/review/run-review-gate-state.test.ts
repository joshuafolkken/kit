import { gate_skip } from '#scripts/gate/gate-skip'
import { gate_tree } from '#scripts/gate/gate-tree'
import { file_map_stamp, type FileMapStamp } from '#scripts/josh/file-map-stamp'
import { review_stamps } from '#scripts/review/review-stamps'
import { review_tree } from '#scripts/review/review-tree'
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
const START_FILES: Record<string, string> = { file: 'started' }
const MOVED_FILES: Record<string, string> = { file: 'fixed' }

function settled_gate_on_moved_tree(is_start_green: boolean): void {
	vi.spyOn(gate_tree, 'read_gate_tree').mockResolvedValue({ files: MOVED_FILES, base: 'base' })
	vi.spyOn(file_map_stamp, 'is_writer_running').mockReturnValue(false)
	vi.spyOn(run_review_steps.start_tree_stamp, 'read').mockReturnValue({
		taken_at: GATE_STAMP.taken_at,
		files: START_FILES,
	})
	vi.spyOn(gate_skip, 'reusable_green_gate').mockImplementation((files) =>
		is_start_green && files === START_FILES ? GATE_STAMP : undefined,
	)
}

describe('read_gate_state after the tree moved', () => {
	// A gate that reused an earlier green writes no record, so the record predates this gate's start.
	it('reads a green on the tree the gate started on as moved, however old the record', async () => {
		settled_gate_on_moved_tree(true)

		expect(await run_review_steps.read_gate_state()).toBe(run_review.GATE_MOVED)
	})

	it('reads red where no green covers the tree the gate started on', async () => {
		settled_gate_on_moved_tree(false)

		expect(await run_review_steps.read_gate_state()).toBe(run_review.GATE_RED)
	})

	it('reads red where no start tree was recorded', async () => {
		settled_gate_on_moved_tree(true)
		vi.spyOn(run_review_steps.start_tree_stamp, 'read').mockReturnValue(undefined)

		expect(await run_review_steps.read_gate_state()).toBe(run_review.GATE_RED)
	})
})

describe('mark_gate_starting', () => {
	it('keeps the tree it marks as the pair start tree', async () => {
		vi.spyOn(review_tree, 'read_changed_tree').mockResolvedValue(START_FILES)
		vi.spyOn(review_stamps.in_flight_stamp, 'write').mockReturnValue('')
		const write_start = vi.spyOn(run_review_steps.start_tree_stamp, 'write').mockReturnValue('')

		await run_review_steps.mark_gate_starting()

		expect(write_start).toHaveBeenCalledWith(START_FILES)
	})
})

import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { observation_ledger_home } from '#scripts/observations/observation-ledger-home'
import { run_review_join_read, type JoinVerdict } from '#scripts/run/review/run-review-join-read'
import { run_review_pinned_join } from '#scripts/run/review/run-review-pinned-join'
import { run_review_pinned_steps } from '#scripts/run/review/run-review-pinned-steps'
import { run_review_pinned_tree } from '#scripts/run/review/run-review-pinned-tree'
import { run_ship_detach } from '#scripts/run/ship/run-ship-detach'
import { test_pinned_logic } from '#scripts/test/test-pinned-logic'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_record_pinned } from './review-record-pinned'

// joshuafolkken/kit#4834: a round-1 fix added hunks the background check never read, and the ship's
// pre-detach was the first to name them, stopping there.

const ROOT = '/checkout'
const LAUNCHED_TREE = 'briefed-tree'
const FIXED_TREE = 'fixed-tree'
const REASON = 'only logs'

beforeEach(() => {
	vi.spyOn(run_review_pinned_steps, 'launched_tree').mockReturnValue(LAUNCHED_TREE)
	vi.spyOn(run_review_pinned_steps, 'launched_reason').mockReturnValue(REASON)
	vi.spyOn(run_review_pinned_steps, 'clear').mockReturnValue(undefined)
	vi.spyOn(run_review_pinned_steps, 'launch').mockReturnValue({ kind: 'launched', pid: 1 })
	vi.spyOn(run_review_pinned_tree, 'key').mockResolvedValue(FIXED_TREE)
	vi.spyOn(console, 'info').mockReturnValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('review_record_pinned.restart_if_moved on a tree the fix moved', () => {
	it("starts the check again on the fixed tree with the launch's reason, and names its read", async () => {
		await expect(review_record_pinned.restart_if_moved(ROOT)).resolves.toBe(true)

		expect(run_review_pinned_steps.clear).toHaveBeenCalledWith(ROOT)
		expect(run_review_pinned_steps.launch).toHaveBeenCalledWith(ROOT, REASON, FIXED_TREE)
		expect(console.info).toHaveBeenCalledExactlyOnceWith(review_record_pinned.started_line())
		expect(review_record_pinned.started_line()).toContain('--unpinned-ok')
	})

	// joshuafolkken/kit#4895: the named foreground read stalled the lane for minutes before the ship.
	it("leaves the answer to the ship's pre-detach, asking no foreground read", () => {
		expect(review_record_pinned.started_line()).not.toContain('run:review --pinned')
		expect(review_record_pinned.started_line()).toContain('pre-detach')
	})

	// joshuafolkken/kit#4987: `check:related` now waits on the check it started.
	it('claims no one waits on the check', () => {
		expect(review_record_pinned.started_line()).not.toContain('nothing waits')
	})

	// joshuafolkken/kit#4948: `check:related` prints it too, one step before `review:record`.
	it('names no next step, so it reads right from check:related as well as review:record', () => {
		expect(review_record_pinned.started_line()).not.toContain('go on to the ship')
	})

	it('names no read when the check could not be started', async () => {
		vi.mocked(run_review_pinned_steps.launch).mockReturnValue({ kind: 'failed', note: 'busy' })

		await expect(review_record_pinned.restart_if_moved(ROOT)).resolves.toBe(false)

		expect(console.info).not.toHaveBeenCalled()
	})
})

describe('review_record_pinned.restart_if_moved — nothing to start', () => {
	it.each([
		['the tree the check was launched on', LAUNCHED_TREE, LAUNCHED_TREE],
		['a checkout with no launch', undefined, FIXED_TREE],
		['a fixed tree git could not read', LAUNCHED_TREE, undefined],
	])('starts nothing on %s', async (_label, launched, current) => {
		vi.mocked(run_review_pinned_steps.launched_tree).mockReturnValue(launched)
		vi.mocked(run_review_pinned_tree.key).mockResolvedValue(current)

		await expect(review_record_pinned.restart_if_moved(ROOT)).resolves.toBe(false)

		expect(run_review_pinned_steps.clear).not.toHaveBeenCalled()
		expect(run_review_pinned_steps.launch).not.toHaveBeenCalled()
		expect(console.info).not.toHaveBeenCalled()
	})

	it('swallows a failure rather than failing the record', async () => {
		vi.mocked(run_review_pinned_tree.key).mockRejectedValue(new Error('git failed'))

		await expect(review_record_pinned.restart_if_moved(ROOT)).resolves.toBe(false)
		expect(run_review_pinned_steps.launch).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#4987: `check:related` waits only on a check this restart started.
describe('review_record_pinned.restart_in_lane answers whether it started a check', () => {
	beforeEach(() => {
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
		vi.spyOn(lane_child_marker, 'marked_issue').mockReturnValue(undefined)
		vi.spyOn(run_ship_detach, 'is_supervised').mockReturnValue(false)
	})

	it('answers true when it started the check on the fixed tree', async () => {
		await expect(review_record_pinned.restart_in_lane(ROOT)).resolves.toBe(true)
	})

	it('answers false when the tree did not move', async () => {
		vi.mocked(run_review_pinned_tree.key).mockResolvedValue(LAUNCHED_TREE)

		await expect(review_record_pinned.restart_in_lane(ROOT)).resolves.toBe(false)
	})

	it('answers false outside a lane child', async () => {
		vi.mocked(lane_child_marker.is_child_of).mockReturnValue(false)

		await expect(review_record_pinned.restart_in_lane(ROOT)).resolves.toBe(false)
		expect(run_review_pinned_steps.launch).not.toHaveBeenCalled()
	})

	it('answers false when the ledger cannot be read', async () => {
		vi.mocked(lane_child_marker.marked_issue).mockReturnValue('4987')
		vi.spyOn(observation_ledger_home, 'read').mockRejectedValue(new Error('unreadable'))

		await expect(review_record_pinned.restart_in_lane(ROOT)).resolves.toBe(false)
	})
})

// joshuafolkken/kit#5212: a lane that skipped `run:review --join` met its unpinned places only as the
// ship's pre-detach failure.
const UNPINNED_LINE = 'unpinned a.ts:3 — no test turns red'
const STOPPED: JoinVerdict = {
	summary: { text: '', unpinned: ['a.ts f'] },
	is_stop: true,
	text: UNPINNED_LINE,
}

function spy_join(is_due: boolean, joined: JoinVerdict | undefined): void {
	vi.spyOn(run_review_join_read, 'is_due').mockReturnValue(is_due)
	vi.spyOn(run_review_join_read, 'read_finished').mockResolvedValue(joined)
	vi.spyOn(test_pinned_logic, 'report_text').mockImplementation(
		(_summary, note = '') => `${UNPINNED_LINE}\n${note}`,
	)
}

describe('review_record_pinned.read_skipped_join', () => {
	it('prints the unpinned lines and the two ways out when the join is still due', async () => {
		spy_join(true, STOPPED)

		await review_record_pinned.read_skipped_join(ROOT)

		expect(run_review_join_read.read_finished).toHaveBeenCalledWith(ROOT)
		expect(console.info).toHaveBeenCalledExactlyOnceWith(
			`${UNPINNED_LINE}\n${review_record_pinned.CHOICE_LINE.trimEnd()}`,
		)
		expect(review_record_pinned.CHOICE_LINE).toContain('--unpinned-ok "<reason>"')
	})

	it('reads nothing and prints nothing once the join was read', async () => {
		spy_join(false, STOPPED)

		await review_record_pinned.read_skipped_join(ROOT)

		expect(run_review_join_read.read_finished).not.toHaveBeenCalled()
		expect(console.info).not.toHaveBeenCalled()
	})

	it('prints nothing for a join that stops nothing', async () => {
		spy_join(true, { ...STOPPED, is_stop: false })

		await review_record_pinned.read_skipped_join(ROOT)

		expect(console.info).not.toHaveBeenCalled()
	})
})

// Round-1 findings of joshuafolkken/kit#5212: the skipped-join read waited in the foreground, and on a
// moved tree restarted the check itself, so the restart after it printed no started line.
describe('review_record_pinned.read_skipped_join, then restart_if_moved on a moved tree', () => {
	it('neither waits nor restarts, so the restart still names its read', async () => {
		vi.spyOn(run_review_join_read, 'is_due').mockReturnValue(true)
		vi.spyOn(run_review_pinned_join, 'finished_on_tree').mockResolvedValue(undefined)
		const wait = vi.spyOn(run_review_pinned_join, 'wait_for_join')

		await review_record_pinned.read_skipped_join(ROOT)
		await review_record_pinned.restart_if_moved(ROOT)

		expect(wait).not.toHaveBeenCalled()
		expect(run_review_pinned_steps.launch).toHaveBeenCalledOnce()
		expect(console.info).toHaveBeenCalledExactlyOnceWith(review_record_pinned.started_line())
	})
})

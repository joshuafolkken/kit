import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { stamp_file } from '#scripts/josh/stamp-file'
import { run_ship_review } from '#scripts/run/ship/run-ship-review'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_attest } from './review-attest'
import { review_brief_cli } from './review-brief-cli'
import type { ReviewCheckout } from './review-checkout'
import { review_reviewed_tree } from './review-reviewed-tree'
import { review_stamps } from './review-stamps'

// joshuafolkken/kit#4620: a resumed brief narrows from the tree `review:record` wrote the lane's
// pre-ship round on, ahead of the ship's briefed tree — a moved tree reviews only the delta since it.

const CHECKOUT: ReviewCheckout = { root: '/lanes/4620', branch: '4620-lane', head: 'head' }
const BASE = 'base-sha'
const FILE = 'a.ts'
const RECORDED: FileMapStamp = {
	taken_at: '2026-10-23T01:00:00.000Z',
	files: { [FILE]: 'y' },
	base: BASE,
}
const BRIEFED: FileMapStamp = {
	taken_at: '2026-10-23T00:00:00.000Z',
	files: { [FILE]: 'x' },
	base: BASE,
}

beforeEach(() => {
	vi.spyOn(review_stamps.briefed_stamp, 'read').mockReturnValue(BRIEFED)
	vi.spyOn(review_attest, 'is_briefed_since').mockReturnValue(true)
	vi.spyOn(review_attest, 'is_reviewed_on').mockReturnValue(true)
	vi.spyOn(stamp_file, 'read_stamp_text').mockReturnValue(undefined)
	vi.spyOn(run_ship_review, 'is_clean_round_one').mockReturnValue(true)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('review_brief_cli.attested_tree', () => {
	it('narrows from the recorded round ahead of the briefed tree', () => {
		vi.spyOn(review_reviewed_tree, 'resume_point').mockReturnValue(RECORDED)

		expect(review_brief_cli.attested_tree(CHECKOUT)).toBe(RECORDED)
		expect(review_stamps.briefed_stamp.read).not.toHaveBeenCalled()
	})

	it('falls back to the tree a clean ship round was briefed on without a recorded round', () => {
		vi.spyOn(review_reviewed_tree, 'resume_point').mockReturnValue(undefined)

		expect(review_brief_cli.attested_tree(CHECKOUT)).toBe(BRIEFED)
	})

	it('narrows from nothing when neither record holds', () => {
		vi.spyOn(review_reviewed_tree, 'resume_point').mockReturnValue(undefined)
		vi.spyOn(run_ship_review, 'is_clean_round_one').mockReturnValue(false)

		expect(review_brief_cli.attested_tree(CHECKOUT)).toBeUndefined()
	})
})

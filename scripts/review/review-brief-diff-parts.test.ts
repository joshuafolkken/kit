import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { describe, expect, it } from 'vitest'
import { review_brief } from './review-brief'
import { review_diff_parts, type DiffParts } from './review-diff-parts'

// joshuafolkken/kit#2963: the whole change is handed over as parts under the Bash output cap, and the
// parts list must name every path the change touches — the read gets smaller, the scope does not.

const CAP = 8000
const ROOT = '/lanes/2963'
const BASE = 'f'.repeat(40)
const NAMES = ['a.ts', 'b.md', 'c.ts']
const TREE: Record<string, string> = Object.fromEntries(NAMES.map((name) => [name, name]))
const PARTS: DiffParts = Object.fromEntries(NAMES.map((name) => [name, [`/parts/${name}-1.diff`]]))
const DIFF = { parts: PARTS, cap: CAP }
const SNAPSHOT: FileMapStamp = { taken_at: '2026-10-03T00:00:00.000Z', files: TREE, base: BASE }
const BLOCK_OPENING = 'Reading the diff:'

function compose(
	diff?: { parts: DiffParts; cap: number },
	round = 1,
	resumed_from?: FileMapStamp,
): string {
	return review_brief.compose({
		level: 'medium',
		round,
		tree: TREE,
		stamps: { gate: undefined, in_flight: undefined, round_one: undefined },
		checkout: { root: ROOT, branch: '2963-lane', head: '0'.repeat(40) },
		nonce: 'deadbeefcafef00d',
		base: BASE,
		rubric_path: '/pkg/prompts/review-rubric.md',
		diff,
		resumed_from,
	})
}

describe('review_brief.compose — the diff is read in parts under the cap', () => {
	it('lists the parts of every changed path, with the Read-tool instruction', () => {
		const brief = compose(DIFF)

		expect(brief).toContain(review_diff_parts.reading_block(PARTS, CAP))

		for (const name of Object.keys(TREE)) expect(brief).toContain(`/parts/${name}-1.diff`)
	})

	it('keeps the whole-change target beside the parts', () => {
		expect(compose(DIFF)).toContain(review_brief.whole_change_target(ROOT, BASE))
	})

	it('prints no parts block when the parts could not be written', () => {
		expect(compose()).not.toContain(BLOCK_OPENING)
	})

	// The parts are the whole change against the base, so beside a narrowed target they would widen it.
	it('prints no parts block beside a round-2 target', () => {
		expect(compose(DIFF, 2)).not.toContain(BLOCK_OPENING)
	})

	it('prints no parts block beside a resumed round-1 target', () => {
		expect(compose(DIFF, 1, SNAPSHOT)).not.toContain(BLOCK_OPENING)
	})
})

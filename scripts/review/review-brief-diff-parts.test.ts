import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { describe, expect, it } from 'vitest'
import { review_brief } from './review-brief'
import { review_diff_parts, type DiffParts } from './review-diff-parts'

// joshuafolkken/kit#2963: the whole change is handed over as parts under the Bash output cap, and the
// parts list must name every path the change touches — the read gets smaller, the scope does not.

const CAP = 8000
const ROOT = '/lanes/2963'
const BASE = 'f'.repeat(40)
const MOVED_BASE = 'e'.repeat(40)
const NAMES = ['a.ts', 'b.md', 'c.ts']
const TREE: Record<string, string> = Object.fromEntries(NAMES.map((name) => [name, name]))
const PARTS: DiffParts = Object.fromEntries(NAMES.map((name) => [name, [`/parts/${name}-1.diff`]]))
const DIFF = { parts: PARTS, cap: CAP }
const TAKEN_AT = '2026-10-03T00:00:00.000Z'
// Records the tree as it is, so comparing against it finds nothing changed.
const SNAPSHOT: FileMapStamp = { taken_at: TAKEN_AT, files: TREE, base: BASE }
// Records `a.ts` as it was before a fix, so comparing against it narrows the target to that one file.
const NARROWING: FileMapStamp = {
	taken_at: TAKEN_AT,
	files: { ...TREE, [NAMES[0] ?? '']: 'old' },
	base: BASE,
}
const BLOCK = review_diff_parts.reading_block(PARTS, CAP)

interface ComposeOptions {
	diff?: { parts: DiffParts; cap: number }
	round?: number
	round_one?: FileMapStamp
	resumed_from?: FileMapStamp
}

function compose(options: ComposeOptions = {}): string {
	return review_brief.compose({
		level: 'medium',
		round: options.round ?? 1,
		tree: TREE,
		stamps: { gate: undefined, in_flight: undefined, round_one: options.round_one },
		checkout: { root: ROOT, branch: '2963-lane', head: '0'.repeat(40) },
		nonce: 'deadbeefcafef00d',
		base: BASE,
		rubric_path: '/pkg/prompts/review-rubric.md',
		diff: options.diff,
		resumed_from: options.resumed_from,
	})
}

describe('review_brief.compose — the diff is read in parts under the cap', () => {
	it('lists the parts of every changed path, with the Read-tool instruction', () => {
		const brief = compose({ diff: DIFF })

		expect(brief).toContain(BLOCK)

		for (const name of Object.keys(TREE)) expect(brief).toContain(`/parts/${name}-1.diff`)
	})

	it('keeps the whole-change target beside the parts', () => {
		expect(compose({ diff: DIFF })).toContain(review_brief.whole_change_target(ROOT, BASE))
	})

	it('prints no parts block when the parts could not be written', () => {
		expect(compose()).not.toContain(BLOCK)
	})
})

// The parts are the whole change against the base, so beside a narrowed target they would widen it —
// but a round that widens back to the whole change needs them as much as a first round does.
describe('review_brief.compose — the parts follow the printed target, not the round', () => {
	it('prints no parts block beside a narrowed round-2 target', () => {
		expect(compose({ diff: DIFF, round: 2, round_one: NARROWING })).not.toContain(BLOCK)
	})

	it('prints no parts block beside a narrowed resumed round-1 target', () => {
		expect(compose({ diff: DIFF, resumed_from: NARROWING })).not.toContain(BLOCK)
	})

	it('prints the parts beside a round 2 that widened for want of a round-1 record', () => {
		expect(compose({ diff: DIFF, round: 2 })).toContain(BLOCK)
	})

	it('prints the parts beside a round 2 whose base moved since round 1', () => {
		const moved: FileMapStamp = { ...NARROWING, base: MOVED_BASE }

		expect(compose({ diff: DIFF, round: 2, round_one: moved })).toContain(BLOCK)
	})

	it('prints the parts beside a resumed round 1 whose target came out empty', () => {
		expect(compose({ diff: DIFF, resumed_from: SNAPSHOT })).toContain(BLOCK)
	})
})

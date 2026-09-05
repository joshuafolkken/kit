import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { describe, expect, it } from 'vitest'
import { review_round2 } from './review-round2'

// joshuafolkken/kit#1433: the second round used to run whenever round 1 found anything, including
// where round 1's findings produced no code at all. The branches below are the whole decision, and
// most of them answer `required` — the default is what keeps a forgotten flag or a missing record
// from buying a skip.

const TAKEN_AT = '2026-09-05T00:00:00.000Z'
const SOURCE = 'src/thing.ts'
const ADDED = 'src/added.ts'
const CHANGELOG = 'CHANGELOG.md'
const PROMPT = 'prompts/review.md'
const TEST_FILE = 'scripts/thing.test.ts'
const BEFORE = 'aaa'
const AFTER = 'bbb'
// What `review-tree.ts` records for a path the change lists but the working tree no longer holds.
const ABSENT = 'absent'

function tree_of(...entries: ReadonlyArray<readonly [string, string]>): Record<string, string> {
	return Object.fromEntries(entries)
}

function snapshot_of(files: Record<string, string>): FileMapStamp {
	return { taken_at: TAKEN_AT, files }
}

const IMPLEMENTATION = tree_of([SOURCE, BEFORE], [CHANGELOG, BEFORE])
const SNAPSHOT = snapshot_of(IMPLEMENTATION)

describe('review_round2.decide — the round is required unless something says otherwise', () => {
	it('requires the round when the caller did not assert round 1 closed', () => {
		const decision = review_round2.decide({
			is_round_one_closed: false,
			snapshot: SNAPSHOT,
			tree: IMPLEMENTATION,
		})

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.reason).toBe(review_round2.OPEN_FINDING_REASON)
		// The flag is read before the tree, so an empty delta cannot answer for a standing finding.
		expect(decision.delta).toStrictEqual([])
	})

	it('requires the round when no round-1 snapshot was recorded', () => {
		const decision = review_round2.decide({
			is_round_one_closed: true,
			snapshot: undefined,
			tree: IMPLEMENTATION,
		})

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.reason).toBe(review_round2.NO_SNAPSHOT_REASON)
	})
})

describe('review_round2.decide — the two skip arms', () => {
	// Arm A. joshuafolkken/kit#1222's reason for the round is that round 1's fix code is unreviewed;
	// here there is none, so the premise is absent rather than overridden.
	it('skips the round when round 1 wrote no fix code', () => {
		const decision = review_round2.decide({
			is_round_one_closed: true,
			snapshot: SNAPSHOT,
			tree: IMPLEMENTATION,
		})

		expect(decision.verdict).toBe(review_round2.SKIPPED_VERDICT)
		expect(decision.reason).toContain(review_round2.EMPTY_DELTA_REASON_PREFIX)
		expect(decision.delta).toStrictEqual([])
		// The one thing that separates "round 1 wrote no fix code" from "the record was retaken after
		// the fixes": the digests read the same either way, and only the timestamp shows the second.
		expect(decision.reason).toContain(TAKEN_AT)
	})

	// Arm B, and it reuses `review_level.is_inert` rather than listing paths again: a second
	// definition of "inert" would let the level printed beside this answer describe a different set.
	it('skips the round when every path round 1 fixed is inert', () => {
		const decision = review_round2.decide({
			is_round_one_closed: true,
			snapshot: SNAPSHOT,
			tree: tree_of([SOURCE, BEFORE], [CHANGELOG, AFTER]),
		})

		expect(decision.verdict).toBe(review_round2.SKIPPED_VERDICT)
		expect(decision.reason).toContain(review_round2.INERT_DELTA_REASON_PREFIX)
		expect(decision.delta).toStrictEqual([CHANGELOG])
	})
})

// The record the run quotes has to name the whole delta: a defect found later is attributed to the
// paths that went unreviewed, and a list truncated at five cannot do that.
describe('review_round2.inert_reason', () => {
	it('names every path of a skipped delta rather than truncating the list', () => {
		// Six, because `format_path_list` lists five and replaces the rest with `+N more`.
		const inert = [
			'a.code-workspace',
			'b.code-workspace',
			'c.code-workspace',
			'.gitignore',
			'LICENSE',
			CHANGELOG,
		]
		const reason = review_round2.inert_reason(inert)

		for (const path of inert) {
			expect(reason).toContain(path)
		}

		expect(reason).not.toContain('more')
	})
})

// The line joshuafolkken/kit#1433 arrived with and this change rejects: a prompt is an instruction
// file and a test is the verification that guards a runtime path, so a fix that touched either one
// still gets the round. `review-level.ts` records the measurement behind it — two documentation-only
// diffs, ten real defects each, none of them covered by a test.
describe('review_round2.decide — a fix outside runtime code still gets the round', () => {
	it('requires the round when a fix touched a distributed prompt', () => {
		const decision = review_round2.decide({
			is_round_one_closed: true,
			snapshot: snapshot_of(tree_of([PROMPT, BEFORE])),
			tree: tree_of([PROMPT, AFTER]),
		})

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.reason).toContain(PROMPT)
	})

	it('requires the round when a fix touched a test file', () => {
		const decision = review_round2.decide({
			is_round_one_closed: true,
			snapshot: snapshot_of(tree_of([TEST_FILE, BEFORE])),
			tree: tree_of([TEST_FILE, AFTER]),
		})

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.reason).toContain(TEST_FILE)
	})

	// One live path among inert ones decides the whole answer, the way one non-inert path decides the
	// review level: a per-file verdict would mean verifying part of a fix.
	it('requires the round when one path of a mostly-inert fix delta executes', () => {
		const decision = review_round2.decide({
			is_round_one_closed: true,
			snapshot: SNAPSHOT,
			tree: tree_of([SOURCE, AFTER], [CHANGELOG, AFTER]),
		})

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.reason).toContain(SOURCE)
		expect(decision.delta).toStrictEqual([CHANGELOG, SOURCE])
	})
})

describe('review_round2.decide — what the fix delta counts', () => {
	// A deleted file reads as `absent` on the tree side rather than dropping out of the map, so the
	// delete is part of the delta and is not mistaken for "unchanged".
	it('counts a file a fix deleted', () => {
		const decision = review_round2.decide({
			is_round_one_closed: true,
			snapshot: SNAPSHOT,
			tree: tree_of([SOURCE, ABSENT], [CHANGELOG, BEFORE]),
		})

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.delta).toStrictEqual([SOURCE])
	})

	// An added file is in the tree and not in the snapshot, so it reaches the comparison from the
	// other side. Without it a fix that wrote a whole new module would read as an empty delta.
	it('counts a file a fix added', () => {
		const decision = review_round2.decide({
			is_round_one_closed: true,
			snapshot: SNAPSHOT,
			tree: tree_of([SOURCE, BEFORE], [CHANGELOG, BEFORE], [ADDED, AFTER]),
		})

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.delta).toStrictEqual([ADDED])
	})
})

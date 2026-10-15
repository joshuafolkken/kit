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
const DOCUMENT = 'docs/maintainers/review-history.md'
const README = 'README.md'
const NESTED_README = 'scripts/README.md'
const CLAUDE_SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CLAUDE_MD = 'CLAUDE.md'
const CONFIG = 'cspell.config.yaml'
const BEFORE = 'aaa'
const AFTER = 'bbb'
// What `review-tree.ts` records for a path the change lists but the working tree no longer holds.
const ABSENT = 'absent'
// One change base throughout: the ordinary run does not move it between the two rounds. The moved
// base is its own arm, asserted below and end to end against real git in
// `review-round2-target-scope.test.ts` (joshuafolkken/kit#1537).
const BASE = '0123456789abcdef0123456789abcdef01234567'

function tree_of(...entries: ReadonlyArray<readonly [string, string]>): Record<string, string> {
	return Object.fromEntries(entries)
}

function snapshot_of(files: Record<string, string>): FileMapStamp {
	return { taken_at: TAKEN_AT, files, base: BASE }
}

const IMPLEMENTATION = tree_of([SOURCE, BEFORE], [CHANGELOG, BEFORE])
const SNAPSHOT = snapshot_of(IMPLEMENTATION)

describe('review_round2.decide — the round is required unless something says otherwise', () => {
	it('requires the round when the caller did not assert round 1 closed', () => {
		const decision = review_round2.decide({
			base: BASE,
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
			base: BASE,
			is_round_one_closed: true,
			snapshot: undefined,
			tree: IMPLEMENTATION,
		})

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.reason).toBe(review_round2.NO_SNAPSHOT_REASON)
	})
})

// joshuafolkken/kit#1537: the base guard, which is read before the digests are.
describe('review_round2.decide — a record measured against another base', () => {
	// A record measured against another commit describes a different set of
	// paths, so an empty delta is not evidence that round 1 wrote no fix code — and here that evidence
	// would buy a `skip`, which leaves the fixes unread entirely.
	it('requires the round when the change base moved since the record was taken', () => {
		const decision = review_round2.decide({
			base: 'fedcba9876543210fedcba9876543210fedcba98',
			is_round_one_closed: true,
			snapshot: SNAPSHOT,
			tree: IMPLEMENTATION,
		})

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.reason).toBe(review_round2.BASE_MOVED_REASON)
	})

	// `resolved_change_base` answers `undefined` where `merge-base` could not be resolved to a commit.
	// Knowing less than the record does is not a match.
	it('requires the round when the base could not be resolved to a commit', () => {
		const decision = review_round2.decide({
			base: undefined,
			is_round_one_closed: true,
			snapshot: SNAPSHOT,
			tree: IMPLEMENTATION,
		})

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.reason).toBe(review_round2.BASE_MOVED_REASON)
	})

	// A record written before the field existed cannot be shown to be comparable, so it falls on the
	// same side as a mismatch. The alternative — treating an absent base as a match — is the state the
	// defect shipped in.
	it('requires the round when the record carries no base at all', () => {
		const decision = review_round2.decide({
			base: BASE,
			is_round_one_closed: true,
			snapshot: { files: IMPLEMENTATION, taken_at: TAKEN_AT },
			tree: IMPLEMENTATION,
		})

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.reason).toBe(review_round2.BASE_MOVED_REASON)
	})
})

describe('review_round2.decide — the two skip arms', () => {
	// Arm A. joshuafolkken/kit#1222's reason for the round is that round 1's fix code is unreviewed;
	// here there is none, so the premise is absent rather than overridden.
	it('skips the round when round 1 wrote no fix code', () => {
		const decision = review_round2.decide({
			base: BASE,
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
			base: BASE,
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

function every_path_at(paths: ReadonlyArray<string>, digest: string): Record<string, string> {
	return Object.fromEntries(paths.map((relative) => [relative, digest]))
}

function decide_fix(
	paths: ReadonlyArray<string>,
	comment_only: ReadonlyArray<string> = [],
): ReturnType<typeof review_round2.decide> {
	return review_round2.decide({
		base: BASE,
		comment_only,
		is_round_one_closed: true,
		snapshot: snapshot_of(every_path_at(paths, BEFORE)),
		tree: every_path_at(paths, AFTER),
	})
}

// joshuafolkken/kit#3826, on the decision recorded on joshuafolkken/kit#3787: a fix that leaves what
// executes unchanged skips the round. Round 1 still reviewed the change and the fix is still made;
// only the re-read of the fix goes.
describe('review_round2.decide — a fix that leaves what executes unchanged', () => {
	it.each([
		['a distributed prompt', [PROMPT]],
		['documentation under docs/', [DOCUMENT]],
		['the root README', [README]],
		['documentation and a prompt together', [DOCUMENT, README, PROMPT]],
	])('skips the round when a fix touched only %s', (_label, paths) => {
		const decision = decide_fix(paths)

		expect(decision.verdict).toBe(review_round2.SKIPPED_VERDICT)
		expect(decision.reason).toContain(review_round2.INERT_DELTA_REASON_PREFIX)
	})

	it('skips the round when a fix changed only the comments of a source file', () => {
		const decision = decide_fix([SOURCE, DOCUMENT], [SOURCE])

		expect(decision.verdict).toBe(review_round2.SKIPPED_VERDICT)
		expect(decision.delta).toStrictEqual([DOCUMENT, SOURCE])
	})
})

// What the decision on joshuafolkken/kit#3787 left outside: an agent's instructions, the verification
// itself, configuration and code. One such path among skippable ones decides the whole answer.
describe('review_round2.decide — a fix outside that range still gets the round', () => {
	it.each([
		['`.claude/**`', CLAUDE_SKILL],
		['`CLAUDE.md`', CLAUDE_MD],
		['a test file', TEST_FILE],
		['configuration', CONFIG],
		['a code line', SOURCE],
		['a Markdown file outside docs/', NESTED_README],
	])('requires the round when a fix touched %s beside documentation', (_label, live) => {
		const decision = decide_fix([DOCUMENT, PROMPT, live])

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.reason).toContain(live)
	})

	// Only the paths the code record vouches for are comment-only; a sibling's code change still counts.
	it('requires the round when one source file changed code beside a comment-only one', () => {
		const decision = decide_fix([SOURCE, ADDED], [SOURCE])

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.reason).toContain(ADDED)
	})

	// One live path among inert ones decides the whole answer, the way one non-inert path decides the
	// review level: a per-file verdict would mean verifying part of a fix.
	it('requires the round when one path of a mostly-inert fix delta executes', () => {
		const decision = review_round2.decide({
			base: BASE,
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
			base: BASE,
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
			base: BASE,
			is_round_one_closed: true,
			snapshot: SNAPSHOT,
			tree: tree_of([SOURCE, BEFORE], [CHANGELOG, BEFORE], [ADDED, AFTER]),
		})

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.delta).toStrictEqual([ADDED])
	})
})

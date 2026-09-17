import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { review_brief } from './review-brief'
import { review_brief_cli } from './review-brief-cli'
import { review_round2 } from './review-round2'
import { review_stamps } from './review-stamps'

// joshuafolkken/kit#1441: `record_round_one` used to overwrite the round-1 snapshot on every round-1
// invocation. A bare `josh review:brief` run after round 1's fixes were in therefore retook it
// against the **fixed** tree, the fix delta read empty, and `josh review:round2 --round-1-closed`
// fired arm A — skipping the second round over fix code nobody had read. The mitigation in place was
// the record's timestamp in the reason line, which nothing compared.
//
// **Every case below asserts the direction, not just the digest.** A record that cannot be trusted
// has to make the round wider; there is no state here whose answer is `skip` on unreviewed code.
//
// **The records are written to an explicit temp path, never the real one.** `josh review:brief` and
// `josh review:round2` share one path per checkout by design, so a suite writing to it would be a
// second writer nobody declared — and it would hand the surrounding run's own round 2 a snapshot
// taken by a test. joshuafolkken/kit#1437 fixed exactly that trap one directory over, where the gate
// suites were writing the real green-gate record.
const RECORD_PATH = path.join(tmpdir(), `josh-review-round1-suite-${String(process.pid)}.json`)

const SOURCE = 'scripts/review/review-brief-cli.ts'
const ADDED_TEST = 'scripts/review/review-round1-snapshot.test.ts'
const IMPLEMENTED = 'aaa'
const FIXED = 'bbb'
// One change base throughout, which is the ordinary run: nothing moves it between the two rounds. A
// record taken against a *different* base is not comparable at all since joshuafolkken/kit#1537, and
// `review-round2-target-scope.test.ts` is where real git moves it.
const BASE = '0123456789abcdef0123456789abcdef01234567'

// The tree round 1 read, and the tree round 1's fixes left behind. The fix added a file as well as
// changing one, because both sides of the comparison have to reach the delta.
const IMPLEMENTATION: Record<string, string> = { [SOURCE]: IMPLEMENTED }
const AFTER_FIXES: Record<string, string> = { [SOURCE]: FIXED, [ADDED_TEST]: FIXED }

function plant(files: Record<string, string>): void {
	review_stamps.round_one_stamp.write(files, RECORD_PATH, BASE)
}

function recorded_files(): Record<string, string> | undefined {
	return review_stamps.round_one_stamp.read(RECORD_PATH)?.files
}

function decide_with_record(tree: Record<string, string>): ReturnType<typeof review_round2.decide> {
	return review_round2.decide({
		base: BASE,
		is_round_one_closed: true,
		snapshot: review_stamps.round_one_stamp.read(RECORD_PATH),
		tree,
	})
}

beforeEach(() => {
	rmSync(RECORD_PATH, { force: true })
	// The kept-record note goes to stderr on purpose; silenced here so a passing suite stays readable.
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(RECORD_PATH, { force: true })
})

describe('review_brief_cli.record_round_one — written once per run, never retaken', () => {
	it('keeps the record the run already has rather than retaking it against the fixed tree', () => {
		plant(IMPLEMENTATION)

		review_brief_cli.record_round_one(review_brief_cli.FIRST_ROUND, AFTER_FIXES, BASE, RECORD_PATH)

		expect(recorded_files()).toStrictEqual(IMPLEMENTATION)
	})

	it('records the snapshot when the run has none yet', () => {
		review_brief_cli.record_round_one(
			review_brief_cli.FIRST_ROUND,
			IMPLEMENTATION,
			BASE,
			RECORD_PATH,
		)

		expect(recorded_files()).toStrictEqual(IMPLEMENTATION)
	})

	it('writes nothing on round 2, which reads the record rather than taking one', () => {
		review_brief_cli.record_round_one(review_brief.SECOND_ROUND, AFTER_FIXES, BASE, RECORD_PATH)

		expect(recorded_files()).toBeUndefined()
	})

	it('says on stderr which record it kept, so the retake is not silent', () => {
		plant(IMPLEMENTATION)
		const taken_at = review_stamps.round_one_stamp.read(RECORD_PATH)?.taken_at ?? ''

		review_brief_cli.record_round_one(review_brief_cli.FIRST_ROUND, AFTER_FIXES, BASE, RECORD_PATH)

		expect(console.error).toHaveBeenCalledWith(
			expect.stringContaining(review_brief_cli.KEPT_NOTE_PREFIX),
		)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(taken_at))
	})
})

// The acceptance criterion of joshuafolkken/kit#1441, asserted end to end across the two commands:
// the retake attempt no longer produces the state that answered `skip`.
describe('the round-2 decision after a round-1 brief is re-run over the fixed tree', () => {
	it('answers required rather than skip, because the kept record still predates the fixes', () => {
		plant(IMPLEMENTATION)

		review_brief_cli.record_round_one(review_brief_cli.FIRST_ROUND, AFTER_FIXES, BASE, RECORD_PATH)
		const decision = decide_with_record(AFTER_FIXES)

		expect(decision.verdict).toBe(review_round2.REQUIRED_VERDICT)
		expect(decision.verdict).not.toBe(review_round2.SKIPPED_VERDICT)
		expect(decision.delta).toStrictEqual([SOURCE, ADDED_TEST])
	})

	// The defect's mechanism, pinned so a later change that reinstates the overwrite fails here
	// rather than shipping: a record taken against the fixed tree is exactly what answered `skip`.
	it('would have answered skip had the record been retaken against the fixed tree', () => {
		plant(AFTER_FIXES)

		const decision = decide_with_record(AFTER_FIXES)

		expect(decision.verdict).toBe(review_round2.SKIPPED_VERDICT)
		expect(decision.reason).toContain(review_round2.EMPTY_DELTA_REASON_PREFIX)
	})
})

describe('review_stamps.clear_round_one — the record lives for one run', () => {
	it('clears the record so the next run records its own round 1', () => {
		plant(IMPLEMENTATION)

		review_stamps.clear_round_one(RECORD_PATH)

		expect(recorded_files()).toBeUndefined()

		review_brief_cli.record_round_one(review_brief_cli.FIRST_ROUND, AFTER_FIXES, BASE, RECORD_PATH)

		expect(recorded_files()).toStrictEqual(AFTER_FIXES)
	})

	// The swallow is what keeps a merged run from being reported as failed over a temp file, so the
	// removal is made to throw rather than asserted against a path that has nothing to remove — that
	// assertion would hold for every possible implementation, including one that always throws.
	it('swallows a removal that fails, so a merged run is not reported as a failed one', () => {
		vi.spyOn(review_stamps.round_one_stamp, 'remove').mockImplementation(() => {
			throw new Error('the temp directory is not writable')
		})

		expect(() => {
			review_stamps.clear_round_one(RECORD_PATH)
		}).not.toThrow()
	})
})

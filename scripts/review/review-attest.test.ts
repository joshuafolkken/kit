import { randomBytes } from 'node:crypto'
import { rmSync } from 'node:fs'
import { afterEach, describe, expect, it } from 'vitest'
import { review_attest } from './review-attest'
import { review_attest_cli } from './review-attest-cli'
import { review_checkout, type ReviewCheckout } from './review-checkout'

// joshuafolkken/kit#1522. `/code-review` is forked by the harness and inherits the session's working
// directory, so a run implementing in a lane can be reviewed against a different checkout entirely —
// one holding the previous child's already-merged code. That review finds nothing wrong and reports
// no findings, and the run reads the silence as a clean round.
//
// **Every case below is written from the direction the error has to fall in.** A review that wrongly
// refuses costs one re-run; a review that wrongly passes ships a diff nobody read. So the absence of
// an attestation is asserted to be a refusal rather than a pass, which is the one shape the defect
// actually took.
//
// The records live in the temp directory keyed by the digest of a string, so each case is isolated by
// handing `record_target` / `check` / `clear` a unique fake root rather than by touching the real one
// — the trap the followup suite one directory over states: this suite must not disturb the records of
// whatever run is executing it.

const LANE: ReviewCheckout = {
	root: '/lanes/1522',
	branch: '1522-lane',
	head: '0123456789abcdef0123456789abcdef01234567',
}

const SESSION: ReviewCheckout = {
	root: '/Users/someone/Development/kit',
	branch: 'main',
	head: 'fedcba9876543210fedcba9876543210fedcba98',
}

const HOUR_MS = 3_600_000
const NOT_REQUIRED = 'not-required'
const MISSING = 'missing'
const MISMATCH = 'mismatch'

const roots: Array<string> = []

function fresh_root(): string {
	const root = `/josh-review-attest-test/${randomBytes(8).toString('hex')}`

	roots.push(root)

	return root
}

afterEach(() => {
	for (const root of roots.splice(0)) {
		const pointer = review_attest.read_pointer(root)

		rmSync(review_attest.pointer_path(root), { force: true })

		if (pointer === undefined) continue

		rmSync(review_attest.expect_path(pointer.nonce), { force: true })
		rmSync(review_attest.attest_path(pointer.nonce), { force: true })
	}
})

// The status of a fresh contract in `root`, so each case states the one thing it is about.
function status_after(actual: ReviewCheckout | undefined, root: string): string {
	const nonce = review_attest.record_target(LANE, root)

	if (actual !== undefined) review_attest.attest(nonce, actual)

	return review_attest.check(Date.now(), root).status
}

describe('review_attest — an unattested review is a refusal, never a pass', () => {
	it('answers not-required where no brief was recorded in this checkout', () => {
		expect(review_attest.check(Date.now(), fresh_root()).status).toBe(NOT_REQUIRED)
	})

	// The defect produced no signal at all, so this is the case that matters most: a check that read
	// silence as success would answer `ok` in exactly the state it exists to catch.
	it('answers missing once a brief was recorded and nothing attested it', () => {
		expect(status_after(undefined, fresh_root())).toBe(MISSING)
	})

	it('answers ok when the review attested the checkout it was briefed on', () => {
		expect(status_after(LANE, fresh_root())).toBe('ok')
	})

	// A second work tree has a different root, which the root test alone catches; a `git switch` inside
	// the right tree does not, and a lane's branch is what its commit lands on.
	it.each([
		['root', SESSION],
		['branch', { ...LANE, branch: 'main' }],
		['head', { ...LANE, head: SESSION.head }],
	])('answers mismatch when the %s differs', (_field, actual) => {
		expect(status_after(actual, fresh_root())).toBe(MISMATCH)
	})
})

// A run that crashed before `josh followup` must not hold the next one hostage. The staleness is only
// ever read in the direction that drops the requirement, so it can never turn a real mismatch into a
// pass.
describe('review_attest — the contract expires rather than locking a checkout', () => {
	it('stops requiring an attestation once the brief is older than a run', () => {
		const root = fresh_root()

		review_attest.record_target(LANE, root)

		const later = Date.now() + review_attest.STALE_AFTER_MS + HOUR_MS

		expect(review_attest.check(later, root).status).toBe(NOT_REQUIRED)
	})

	it('still requires one inside that window', () => {
		const root = fresh_root()

		review_attest.record_target(LANE, root)

		expect(review_attest.check(Date.now() + HOUR_MS, root).status).toBe(MISSING)
	})

	// **Evidence does not expire.** The expiry is about a contract nothing ever answered; a recorded
	// mismatch is an answer. Read the other way round, a run that parks, waits on CI or resumes the
	// next morning would merge on exactly the review this record exists to catch.
	it('keeps refusing a recorded mismatch however old the brief is', () => {
		const root = fresh_root()
		const nonce = review_attest.record_target(LANE, root)

		review_attest.attest(nonce, SESSION)

		const later = Date.now() + review_attest.STALE_AFTER_MS + HOUR_MS

		expect(review_attest.check(later, root).status).toBe(MISMATCH)
	})

	// The pair can come apart: `record_target` drops the previous nonce's records before writing the
	// new ones, so a failed write leaves a live pointer naming an expectation that is gone. Read as
	// "nothing to check", every merge in that checkout would pass unguarded until the pointer expired.
	it('answers missing when the pointer outlives the expectation it names', () => {
		const root = fresh_root()
		const nonce = review_attest.record_target(LANE, root)

		rmSync(review_attest.expect_path(nonce), { force: true })

		expect(review_attest.check(Date.now(), root).status).toBe(MISSING)
	})
})

describe('review_attest.attest — the fork is told at the moment it would have reported', () => {
	it('reports ok and records what it read', () => {
		const nonce = review_attest.record_target(LANE, fresh_root())

		expect(review_attest.attest(nonce, LANE).status).toBe('ok')
		expect(review_attest.read_attestation(nonce)).toStrictEqual(LANE)
	})

	// Recorded even on a mismatch: it is what lets the run say *which* tree was read rather than only
	// that something was wrong.
	it('records the wrong checkout it read, alongside the mismatch', () => {
		const nonce = review_attest.record_target(LANE, fresh_root())
		const verdict = review_attest.attest(nonce, SESSION)

		expect(verdict.status).toBe(MISMATCH)
		expect(verdict.expected).toStrictEqual(LANE)
		expect(review_attest.read_attestation(nonce)).toStrictEqual(SESSION)
	})

	it('refuses a nonce no brief recorded, and writes nothing for it', () => {
		const unknown = randomBytes(8).toString('hex')

		expect(review_attest.attest(unknown, LANE).status).toBe(MISSING)
		expect(review_attest.read_attestation(unknown)).toBeUndefined()
	})
})

describe('review_attest.clear — the contract lives for one run', () => {
	it('removes the pointer and both records', () => {
		const root = fresh_root()
		const nonce = review_attest.record_target(LANE, root)

		review_attest.attest(nonce, LANE)
		review_attest.clear(root)

		expect(review_attest.check(Date.now(), root).status).toBe(NOT_REQUIRED)
		expect(review_attest.read_expectation(nonce)).toBeUndefined()
		expect(review_attest.read_attestation(nonce)).toBeUndefined()
	})
})

describe('review_attest.refusal_message — it names both trees and the way out', () => {
	it('says which checkout was briefed and which was read', () => {
		const message = review_attest.refusal_message({
			status: MISMATCH,
			expected: LANE,
			actual: SESSION,
		})

		expect(message).toContain(review_attest.MISMATCH_VERDICT)
		expect(message).toContain(review_checkout.describe_checkout(LANE))
		expect(message).toContain(review_checkout.describe_checkout(SESSION))
		expect(message).toContain('review:attest')
	})

	it('explains that an absent attestation is treated as no review', () => {
		expect(review_attest.refusal_message({ status: MISSING, expected: LANE })).toContain(
			review_attest.MISSING_REASON,
		)
	})
})

describe('review_attest_cli.run — the usage is refused rather than guessed at', () => {
	it.each([[[]], [['--check', 'extra']], [['not-a-nonce']], [['--verify']]])(
		'refuses %j',
		async (argv) => {
			await expect(review_attest_cli.run(argv)).resolves.toBe(1)
		},
	)
})

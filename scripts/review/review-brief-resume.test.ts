import { randomBytes } from 'node:crypto'
import { mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import type { FileMapStamp } from '#scripts/josh/file-map-stamp'
import { afterAll, afterEach, describe, expect, it } from 'vitest'
import { review_attest } from './review-attest'
import { review_brief } from './review-brief'
import type { ReviewCheckout } from './review-checkout'

// joshuafolkken/kit#2945. A ship stopped mid-run and re-issued ran round 1 against the whole change
// again, so the reviewer re-read every file the attested review had just read — 78 / 80 requests on
// joshuafolkken/kit#2919 for two briefs that differed only in the nonce and the gate line. A resumed
// round 1 is now scoped to what changed since that tree; every reading that cannot narrow widens.

const TAKEN_AT = '2026-10-02T01:00:00.000Z'
const BASE = 'fedcba9876543210fedcba9876543210fedcba98'
const OTHER_BASE = '89abcdef0123456789abcdef0123456789abcdef'
const FILE_A = 'alpha.ts'
const FILE_B = 'beta.ts'
const EDITED = 'edited'
const WHOLE_CHANGE = 'Target: the whole change'

const CHECKOUT: ReviewCheckout = {
	root: '/lanes/2945',
	branch: '2945-lane',
	head: '0123456789abcdef0123456789abcdef01234567',
}

const BEFORE = { [FILE_A]: 'x', [FILE_B]: 'y' }
const AFTER = { ...BEFORE, [FILE_A]: EDITED }

function snapshot_of(files: Record<string, string>, base: string = BASE): FileMapStamp {
	return { taken_at: TAKEN_AT, files, base }
}

function compose(input: {
	tree: Record<string, string>
	round_one?: FileMapStamp
	resumed_from?: FileMapStamp
}): string {
	return review_brief.compose({
		level: 'medium',
		profile: agent_role_profile.DEFAULT_PROFILES.reviewer,
		round: 1,
		tree: input.tree,
		stamps: { gate: undefined, in_flight: undefined, round_one: input.round_one },
		checkout: CHECKOUT,
		nonce: 'deadbeefcafef00d',
		base: BASE,
		rubric_path: '/pkg/prompts/review-rubric.md',
		...(input.resumed_from !== undefined && { resumed_from: input.resumed_from }),
	})
}

describe('review_brief.compose — a resumed round 1 reads the delta since the attested tree', () => {
	it('targets only the files changed since the attested review read the tree', () => {
		const brief = compose({ tree: AFTER, resumed_from: snapshot_of(BEFORE) })

		expect(brief).toContain(review_brief.RESUMED_HEADING)
		expect(brief).toContain(`${CHECKOUT.root}/${FILE_A}`)
		expect(brief).not.toContain(`${CHECKOUT.root}/${FILE_B}`)
		expect(brief).not.toContain(WHOLE_CHANGE)
	})

	it('keeps the whole change when no review was attested', () => {
		const brief = compose({ tree: AFTER, round_one: snapshot_of(BEFORE) })

		expect(brief).toContain(WHOLE_CHANGE)
		expect(brief).not.toContain(review_brief.RESUMED_HEADING)
	})

	it('measures from the briefed tree, not the older round-1 snapshot', () => {
		// The round-1 snapshot holds the content a later review had `beta.ts` changed away from; the
		// tree is back at that content, so measuring from the snapshot would skip it.
		const tree = { [FILE_A]: 'x', [FILE_B]: 'y' }
		const brief = compose({
			tree,
			round_one: snapshot_of(tree),
			resumed_from: snapshot_of({ ...tree, [FILE_B]: EDITED }),
		})

		expect(brief).toContain(`${CHECKOUT.root}/${FILE_B}`)
		expect(brief).not.toContain(`${CHECKOUT.root}/${FILE_A}`)
	})

	it('widens to the whole change when the base moved since the briefed tree', () => {
		const brief = compose({ tree: AFTER, resumed_from: snapshot_of(BEFORE, OTHER_BASE) })

		expect(brief).toContain(WHOLE_CHANGE)
	})

	it('widens to the whole change when nothing changed since the attested tree', () => {
		const brief = compose({ tree: BEFORE, resumed_from: snapshot_of(BEFORE) })

		expect(brief).toContain(WHOLE_CHANGE)
		expect(brief).not.toContain(review_brief.RESUMED_HEADING)
	})
})

const roots: Array<string> = []
const SCRATCH = mkdtempSync(path.join(tmpdir(), 'josh-review-resume-'))

function fresh_root(): string {
	const root = `/josh-review-resume-test/${randomBytes(8).toString('hex')}`

	roots.push(root)

	return root
}

function findings_file(): string {
	return path.join(SCRATCH, `${randomBytes(8).toString('hex')}.txt`)
}

// Set explicitly rather than left to the write: Linux stamps a new file from the coarse clock, which
// can lag the `Date.now()` a pointer minted a moment earlier, so an unset mtime could read as older
// than the brief and fail a case for the wrong reason.
const AFTER_BRIEF_MS = 60_000

function written_findings(mtime: Date = new Date(Date.now() + AFTER_BRIEF_MS)): string {
	const target = findings_file()

	writeFileSync(target, '')
	utimesSync(target, mtime, mtime)

	return target
}

function attested_root(): string {
	const root = fresh_root()

	review_attest.attest(review_attest.record_target(CHECKOUT, root), CHECKOUT)

	return root
}

afterEach(() => {
	for (const root of roots.splice(0)) review_attest.clear(root)
})

afterAll(() => {
	rmSync(SCRATCH, { recursive: true, force: true })
})

describe('review_attest.is_reviewed_on — the resume needs a review that finished', () => {
	it('answers true once the attested review wrote its findings after the brief', () => {
		const root = attested_root()
		const findings = written_findings()

		expect(review_attest.is_reviewed_on(CHECKOUT, findings, root)).toBe(true)
	})

	it('answers false when the attested review died before writing findings', () => {
		expect(review_attest.is_reviewed_on(CHECKOUT, findings_file(), attested_root())).toBe(false)
	})

	it('answers false for findings left by a review older than the brief', () => {
		const stale = written_findings(new Date(TAKEN_AT))

		expect(review_attest.is_reviewed_on(CHECKOUT, stale, attested_root())).toBe(false)
	})

	it('answers false for a review attested on another branch at the same root', () => {
		const findings = written_findings()
		const other = { ...CHECKOUT, branch: 'other-lane' }

		expect(review_attest.is_reviewed_on(other, findings, attested_root())).toBe(false)
	})

	it('answers false when no brief was minted', () => {
		const findings = written_findings()

		expect(review_attest.is_reviewed_on(CHECKOUT, findings, fresh_root())).toBe(false)
	})

	it('answers false when the brief was minted but never attested', () => {
		const root = fresh_root()

		review_attest.record_target(CHECKOUT, root)
		const findings = written_findings()

		expect(review_attest.is_reviewed_on(CHECKOUT, findings, root)).toBe(false)
	})
})

describe('review_attest.is_briefed_since — the briefed tree must be the pointer brief’s own', () => {
	it('answers true for a record written after the pointer was minted', () => {
		const root = attested_root()

		expect(review_attest.is_briefed_since(new Date().toISOString(), root)).toBe(true)
	})

	it('answers false for a record left by an earlier brief', () => {
		expect(review_attest.is_briefed_since(TAKEN_AT, attested_root())).toBe(false)
	})

	it('answers false for a record when no brief was minted', () => {
		expect(review_attest.is_briefed_since(new Date().toISOString(), fresh_root())).toBe(false)
	})
})

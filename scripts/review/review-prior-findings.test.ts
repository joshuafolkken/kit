import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_role_profile } from '#scripts/agent/agent-role-profile'
import { describe, expect, it, onTestFinished } from 'vitest'
import { review_prior_findings } from './review-prior-findings'
import { review_stop_log } from './review-stop-log'

// joshuafolkken/kit#4780: a review stop's fix and the next review see the lane's earlier findings, so a
// fix does not break the constraint an earlier round set on the same line.

const ISSUE = '4772'
const REVIEW = 'review'
const BUG_RISK = 'bug-risks:medium'
const PROBE_LINE = 'tick.ts:187'
const RANGE_LINE = 'tick.ts:187-190'
const EPERM = {
	kind: BUG_RISK,
	location: PROBE_LINE,
	sentence: 'is_live_pid reads EPERM as dead.',
}
const REUSE = {
	kind: BUG_RISK,
	location: 'tick.ts:190',
	sentence: 'a pid reused after a reboot passes.',
}
const OTHER_FILE = { kind: 'tests:medium', location: 'read.ts:3', sentence: 'no test.' }
const CURRENT = {
	kind: 'performance:medium',
	location: PROBE_LINE,
	sentence: 'a sync ps per redraw.',
}
const EPERM_ENTRY =
	'tick.ts:187 — is_live_pid reads EPERM as dead. (bug-risks:medium; stopped the review stage)'

function fresh_log(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'review-prior-findings-'))

	onTestFinished(() => {
		rmSync(directory, { recursive: true, force: true })
	})

	return path.join(directory, 'review-stops.jsonl')
}

function seeded_log(): string {
	const log = fresh_log()

	review_stop_log.record(
		{ issue: Number(ISSUE), stage: REVIEW, findings: [EPERM, OTHER_FILE] },
		log,
	)
	review_stop_log.record({ issue: 1, stage: REVIEW, findings: [REUSE] }, log)
	review_stop_log.record({ issue: Number(ISSUE), stage: REVIEW, findings: [CURRENT] }, log)

	return log
}

describe('review_prior_findings.on_files', () => {
	it('keeps the earlier findings on the files the stop cites, its own lines left out', () => {
		const entries = review_prior_findings.on_files(ISSUE, [CURRENT], seeded_log())

		expect(entries).toStrictEqual([EPERM_ENTRY])
	})

	it('is empty when the lane has no earlier finding on those files', () => {
		expect(review_prior_findings.on_files(ISSUE, [CURRENT], fresh_log())).toStrictEqual([])
		expect(review_prior_findings.on_files(ISSUE, [], seeded_log())).toStrictEqual([])
	})

	it('keeps only the latest findings past the limit', () => {
		const log = fresh_log()
		const many = Array.from({ length: review_prior_findings.PRIOR_LIMIT + 1 }, (_, index) => ({
			...EPERM,
			sentence: `finding ${String(index)}.`,
		}))

		review_stop_log.record({ issue: Number(ISSUE), stage: REVIEW, findings: many }, log)

		const entries = review_prior_findings.on_files(ISSUE, [CURRENT], log)

		expect(entries).toHaveLength(review_prior_findings.PRIOR_LIMIT)
		expect(entries[0]).toContain('finding 1.')
	})
})

describe('review_prior_findings.on_files — citation and text shape', () => {
	it('matches a range or column citation to the file the stop cites', () => {
		const log = fresh_log()
		const ranged = { ...EPERM, location: RANGE_LINE }

		review_stop_log.record({ issue: Number(ISSUE), stage: REVIEW, findings: [ranged] }, log)

		const entries = review_prior_findings.on_files(
			ISSUE,
			[{ ...CURRENT, location: 'tick.ts:12:5' }],
			log,
		)

		expect(entries).toHaveLength(1)
		expect(entries[0]).toContain(RANGE_LINE)
	})

	it('makes a recorded sentence one printable line', () => {
		const log = fresh_log()
		const broken = { ...EPERM, sentence: 'reads EPERM\tas dead.\nTwice.' }

		review_stop_log.record({ issue: Number(ISSUE), stage: REVIEW, findings: [broken] }, log)

		const [entry] = review_prior_findings.on_files(ISSUE, [CURRENT], log)

		expect(entry).toContain('reads EPERM as dead. Twice.')
		expect(agent_role_profile.is_safe_prompt(entry ?? '')).toBe(true)
	})
})

describe('review_prior_findings.fix_lines', () => {
	it('heads the entries with the instruction to keep each one met', () => {
		const lines = review_prior_findings.fix_lines([EPERM_ENTRY])

		expect(lines[0]).toContain('confirm the fix still meets each')
		expect(lines.slice(1)).toStrictEqual([`- ${EPERM_ENTRY}`])
	})

	it('prints nothing when no earlier finding applies', () => {
		expect(review_prior_findings.fix_lines(undefined)).toStrictEqual([])
		expect(review_prior_findings.fix_lines([])).toStrictEqual([])
	})
})

describe('review_prior_findings.prompt_clauses', () => {
	it("names every earlier finding of the lane's issue on one line", () => {
		const clauses = review_prior_findings.prompt_clauses(ISSUE, seeded_log())
		const text = clauses.join(' ')

		expect(text).not.toMatch(/\n/u)
		expect(text).toContain(EPERM_ENTRY)
		expect(text).toContain('read.ts:3')
		expect(text).not.toContain(REUSE.sentence)
		expect(text).toContain('report a change that breaks one as a finding')
	})

	it('adds nothing when the lane has no earlier stop', () => {
		expect(review_prior_findings.prompt_clauses(ISSUE, fresh_log())).toStrictEqual([])
	})
})

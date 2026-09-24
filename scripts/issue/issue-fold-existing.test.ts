import { describe, expect, it } from 'vitest'
import { issue_fold_existing, type ExistingAssessment } from './issue-fold-existing'

const READY: ExistingAssessment = {
	content: 'compatible',
	is_open: true,
	is_unstarted: true,
	has_pull_request: false,
	has_complete_read: true,
	has_dependency_conflict: false,
	is_separable: true,
	size_verdict: 'single',
}
const ORIGINAL_CRITERION = 'Original criterion'
const ADDITIONAL_CRITERION = 'Additional criterion'
const VERIFICATION = 'Run the focused unit test'
const INCOMPATIBLE: ReadonlyArray<Partial<ExistingAssessment>> = [
	{ content: 'separate' },
	{ is_unstarted: false },
	{ has_pull_request: true },
	{ has_dependency_conflict: true },
	{ size_verdict: 'split' },
]
const UNKNOWN: ReadonlyArray<Partial<ExistingAssessment>> = [
	{ content: 'unknown' },
	{ is_open: undefined },
	{ is_unstarted: undefined },
	{ has_pull_request: undefined },
	{ has_complete_read: false },
]

describe('issue_fold_existing.decide', () => {
	it('folds a compatible addition into an unstarted issue under one gate', () => {
		expect(issue_fold_existing.decide(READY)).toBe('fold')
	})

	it('recognizes a complete duplicate without asking for a body edit', () => {
		expect(issue_fold_existing.decide({ ...READY, content: 'duplicate' })).toBe('duplicate')
	})

	it.each(INCOMPATIBLE)('keeps an incompatible candidate on the filing path: %o', (change) => {
		const assessment: ExistingAssessment = { ...READY, ...change }

		expect(issue_fold_existing.decide(assessment)).toBe('separate')
	})

	it.each(UNKNOWN)('withholds a verdict when evidence is missing: %o', (change) => {
		const assessment: ExistingAssessment = { ...READY, ...change }

		expect(issue_fold_existing.decide(assessment)).toBe('inspect')
	})
})

describe('issue_fold_existing.append_requirements', () => {
	it('retains the original body and adds the draft and verification', () => {
		const body = issue_fold_existing.append_requirements(
			`## Goal\n\n${ORIGINAL_CRITERION}\n\n## Decision\n\nKeep this`,
			ADDITIONAL_CRITERION,
			VERIFICATION,
		)

		expect(body).toContain(`${ORIGINAL_CRITERION}\n\n## Decision\n\nKeep this`)
		expect(body).toContain(ADDITIONAL_CRITERION)
		expect(body).toContain(VERIFICATION)
	})
})

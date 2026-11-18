import { describe, expect, it } from 'vitest'
import { review_finding_spec } from './review-finding-spec'

describe('review_finding_spec.parse_positional', () => {
	it('reads a disposition, a kind, the spec and the reason together', () => {
		expect(
			review_finding_spec.parse_positional('fixed kind=stale-docs comments:low:a.ts:3 — stale'),
		).toEqual({
			finding: {
				category: 'comments',
				severity: 'low',
				file: 'a.ts:3',
				disposition: 'fixed',
				kind: 'stale-docs',
			},
			description: 'stale',
		})
	})

	it('reads a kind without a disposition', () => {
		expect(
			review_finding_spec.parse_positional('kind=edge-input tests:medium:b.ts')?.finding,
		).toEqual({ category: 'tests', severity: 'medium', file: 'b.ts', kind: 'edge-input' })
	})

	it('reads a positional written without a kind as before', () => {
		expect(review_finding_spec.parse_positional('tests:low:c.ts')?.finding).toEqual({
			category: 'tests',
			severity: 'low',
			file: 'c.ts',
		})
	})

	it.each(['kind=typo tests:low:a.ts', 'fixed kind=typo tests:low:a.ts'])(
		'refuses %s, whose kind is outside the list',
		(positional) => {
			expect(review_finding_spec.parse_positional(positional)).toBeUndefined()
		},
	)
})

describe('review_finding_spec.parse_finding', () => {
	it('refuses an unknown category', () => {
		expect(review_finding_spec.parse_finding('typo:low:a.ts')).toBeUndefined()
	})
})

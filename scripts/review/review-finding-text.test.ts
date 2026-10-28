import { describe, expect, it } from 'vitest'
import { review_finding_text } from './review-finding-text'

const SPEC = 'bug-risks:medium:a.ts:3'

describe('review_finding_text.split_description', () => {
	it('splits the spec from the reason at the em dash', () => {
		expect(review_finding_text.split_description(`${SPEC} — reads EPERM as dead.`)).toEqual({
			spec: SPEC,
			description: 'reads EPERM as dead.',
		})
	})

	it('ends the spec at a typed `-` or `--` too', () => {
		expect(review_finding_text.split_description(`${SPEC} -- why.`).spec).toBe(SPEC)
		expect(review_finding_text.split_description(`${SPEC} - why.`).spec).toBe(SPEC)
	})

	it('reads a spec with no reason as the spec alone', () => {
		expect(review_finding_text.split_description(` ${SPEC} `)).toEqual({
			spec: SPEC,
			description: '',
		})
	})
})

describe('review_finding_text.first_sentence', () => {
	it('keeps the first sentence only, a Japanese one included', () => {
		expect(review_finding_text.first_sentence('One. Two.')).toBe('One.')
		expect(review_finding_text.first_sentence('一つ目。二つ目。')).toBe('一つ目。')
	})

	it('caps a run-on sentence at the limit with an ellipsis', () => {
		const sentence = review_finding_text.first_sentence(
			'x'.repeat(review_finding_text.SENTENCE_LIMIT + 1),
		)

		expect(sentence).toHaveLength(review_finding_text.SENTENCE_LIMIT)
		expect(sentence.endsWith('…')).toBe(true)
	})
})

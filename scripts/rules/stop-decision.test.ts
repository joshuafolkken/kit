import { describe, expect, it } from 'vitest'
import { stop_decision } from './stop-decision'

// joshuafolkken/kit#3961: the confirmation carries the reply's own choices, and a question the
// person asked is answered rather than announced.

describe('stop_decision.decision_of', () => {
	it('reads a plain recommended line with no alternative', () => {
		const message = 'Paused before the merge.\nRecommended: merge it'

		expect(stop_decision.decision_of(message)).toEqual({
			recommended: 'merge it',
			alternative: undefined,
		})
	})

	it('reads bulleted, bold lines and the alternative', () => {
		const message = '- **Recommended:** merge it\n- **Alternative:** hold it'

		expect(stop_decision.decision_of(message)).toEqual({
			recommended: 'merge it',
			alternative: 'hold it',
		})
	})

	it('keeps the underscores and asterisks inside a choice', () => {
		const message = '**Recommended: split `stop_rules` into a*b**'

		expect(stop_decision.decision_of(message)?.recommended).toBe('split `stop_rules` into a*b')
	})

	it.each([
		['no decision line', 'The run is done.'],
		['an empty recommended line', 'Recommended:'],
		['only an alternative', 'Alternative: hold it'],
	])('names no decision for %s', (_label, message) => {
		expect(stop_decision.decision_of(message)).toBeUndefined()
	})
})

describe('stop_decision.is_question', () => {
	it.each(['what does this do?', 'これは何？', 'これで良いですか', '大丈夫かな', 'どうです か。 '])(
		'reads %s as a question',
		(prompt) => {
			expect(stop_decision.is_question(prompt)).toBe(true)
		},
	)

	it.each(['implement it', '進めてください。', ''])('reads %s as no question', (prompt) => {
		expect(stop_decision.is_question(prompt)).toBe(false)
	})
})

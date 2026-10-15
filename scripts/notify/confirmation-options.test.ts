import { afterEach, describe, expect, it, vi } from 'vitest'
import { confirmation_options } from './confirmation-options'

const LANG_KEY = 'JOSH_SESSION_LANG'
const RECOMMENDED = 'Resume it'
const FIRST = 'Leave it'
const SECOND = 'Close the Issue'

afterEach(() => {
	vi.unstubAllEnvs()
})

describe('confirmation_options.block — headings follow JOSH_SESSION_LANG', () => {
	it('uses the Japanese headings for ja', () => {
		vi.stubEnv(LANG_KEY, 'ja')

		expect(confirmation_options.block({ recommended: RECOMMENDED, alternatives: [FIRST] })).toBe(
			`推奨: ${RECOMMENDED}\n他の選択肢:\n- ${FIRST}`,
		)
	})

	it('uses the Japanese headings when the language is unset', () => {
		vi.stubEnv(LANG_KEY, undefined)

		expect(confirmation_options.block({ recommended: RECOMMENDED, alternatives: [] })).toContain(
			'推奨:',
		)
	})

	it('uses the English headings for en', () => {
		vi.stubEnv(LANG_KEY, 'en')

		expect(
			confirmation_options.block({ recommended: RECOMMENDED, alternatives: [FIRST, SECOND] }),
		).toBe(`Recommended: ${RECOMMENDED}\nAlternatives:\n- ${FIRST}\n- ${SECOND}`)
	})
})

describe('confirmation_options.block — the alternatives', () => {
	it('states none in English when there is no alternative', () => {
		vi.stubEnv(LANG_KEY, 'en')

		expect(confirmation_options.block({ recommended: RECOMMENDED, alternatives: [] })).toBe(
			`Recommended: ${RECOMMENDED}\nAlternatives: none`,
		)
	})

	it('states none in Japanese when there is no alternative', () => {
		vi.stubEnv(LANG_KEY, 'ja')

		expect(confirmation_options.block({ recommended: RECOMMENDED, alternatives: [] })).toBe(
			`推奨: ${RECOMMENDED}\n他の選択肢: なし`,
		)
	})
})

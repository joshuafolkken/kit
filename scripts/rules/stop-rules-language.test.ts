import { describe, expect, it } from 'vitest'
import { stop_rules } from './stop-rules'
import { stop_rules_fixture } from './stop-rules-fixture'

const { context } = stop_rules_fixture

const ENGLISH_REPLY =
	'The gate passed and the pull request is open; the review found nothing to fix.'
const JAPANESE_REPLY =
	'ゲートは通過し、PR を作成しました。レビューで修正すべき指摘はありませんでした。'

function envelope_reason(reason: string, lang: string): string {
	const parsed: unknown = JSON.parse(stop_rules.block_envelope(reason, lang))

	return (parsed as { reason: string }).reason
}

describe('stop_rules.stop_outcome — session language (joshuafolkken/kit#2470)', () => {
	it.each([
		['ja', ENGLISH_REPLY],
		['en', JAPANESE_REPLY],
	])('sends back a reply not written in the %s session language', (session_lang, message) => {
		const { reason } = stop_rules.stop_outcome(context({ session_lang, message }))

		expect(reason).toBe(stop_rules.build_language_reason(session_lang))
	})

	it.each([
		['ja', JAPANESE_REPLY],
		['en', ENGLISH_REPLY],
	])('lets a reply written in the %s session language stop', (session_lang, message) => {
		expect(stop_rules.stop_outcome(context({ session_lang, message })).reason).toBeUndefined()
	})

	it('sends a reply back only once — the loop-breaker lets the rewrite stop', () => {
		const looped = context({ session_lang: 'ja', message: ENGLISH_REPLY, stop_hook_active: true })

		expect(stop_rules.stop_outcome(looped).reason).toBeUndefined()
	})

	it('reports a bare Issue citation ahead of the language', () => {
		const both = context({ session_lang: 'ja', message: `${ENGLISH_REPLY} Filed #7.` })

		expect(stop_rules.stop_outcome(both).reason).toContain('issue citation')
	})
})

describe('stop_rules.block_envelope — every refusal names the session language', () => {
	it.each(['ja', 'en'])('appends the %s session-language instruction to the reason', (lang) => {
		const reason = envelope_reason(stop_rules.PICKUP_REASON, lang)

		expect(reason).toContain(stop_rules.PICKUP_REASON)
		expect(reason).toContain(`JOSH_SESSION_LANG: ${lang}`)
	})
})

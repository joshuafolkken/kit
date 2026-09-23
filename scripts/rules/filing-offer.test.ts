import { describe, expect, it } from 'vitest'
import { filing_offer } from './filing-offer'

const OWNER = 'joshuafolkken'

describe('filing_offer.offers_filing — an offer is detected', () => {
	it.each([
		'起票するのが妥当だと考えます。起票してよければ言ってください。',
		'この所見は起票しましょうか？',
		'別 Issue として起票してもよろしいですか。',
		'Issue 化しますか？',
		'Shall I file this as a follow-up?',
		'Want me to open an issue for it?',
		'Let me know if you want it filed.',
	])('flags %s', (message) => {
		expect(filing_offer.offers_filing(message)).toBe(true)
	})
})

describe('filing_offer.offers_filing — a report or an excluded line is not an offer', () => {
	it.each([
		'起票しました: [#2430](https://github.com/joshuafolkken/kit/issues/2430) — 停止ガード',
		'Filed [#12](https://github.com/o/r/issues/12) as a follow-up.',
		'> 起票してよければ言ってください',
		'```\n起票してよければ言ってください\n```',
		'',
	])('is silent on %s', (message) => {
		expect(filing_offer.offers_filing(message)).toBe(false)
	})
})

describe('filing_offer.is_first_party_target', () => {
	it('treats a reply naming no repository as first-party once the owner is known', () => {
		expect(filing_offer.is_first_party_target('起票してよければ', OWNER)).toBe(true)
	})

	it('treats a reply naming only the session owner as first-party', () => {
		const message = 'joshuafolkken/kit#1 に続けて起票しましょうか'

		expect(filing_offer.is_first_party_target(message, OWNER)).toBe(true)
	})

	it('is not first-party when the reply names a third-party repository', () => {
		const message = 'https://github.com/sveltejs/kit に起票してよければ言ってください'

		expect(filing_offer.is_first_party_target(message, OWNER)).toBe(false)
	})

	it('is not first-party when a third-party target sits on the line before the offer', () => {
		const message =
			'原因は sveltejs/kit 側です（https://github.com/sveltejs/kit/issues/123）。\n起票してよければ言ってください'

		expect(filing_offer.is_first_party_target(message, OWNER)).toBe(false)
	})

	it('is not first-party when the session owner cannot be read', () => {
		expect(filing_offer.is_first_party_target('起票してよければ', undefined)).toBe(false)
	})

	it('reads owners from both a URL and a qualified reference', () => {
		const message = 'see https://github.com/a/b and c/d#3'

		expect(filing_offer.mentioned_owners(message)).toEqual(['a', 'c'])
	})
})

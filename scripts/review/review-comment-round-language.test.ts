import { session_language } from '#scripts/josh/session-language'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { review_comment_round } from './review-comment-round'

// joshuafolkken/kit#7665: only the note a person reads follows `JOSH_SESSION_LANG`; the heading and
// the ledger lines the carry matches stay English, so a round of either language reads back alike.

const ROUND = ['- rf:tests | low | scripts/a.ts:2 | 2026-11-16 | #7665']
const HEADING = '### Review round recorded after the pull request opened'
const JAPANESE_NOTE_MARK = '観察台帳ではなくここに残す'
const ENGLISH_NOTE_MARK = 'Kept here rather than in the observation ledger'
const NOTE_INDEX = 2
const OWNER = 'OWNER'

afterEach(() => {
	vi.unstubAllEnvs()
})

// An empty value resolves as an unset one does (`session-language.ts`).
function body_in(lang: string): string {
	vi.stubEnv(session_language.ENV_KEY, lang)

	return review_comment_round.body_of(ROUND)
}

function without_note(body: string): Array<string> {
	return body.split('\n').filter((_line, index) => index !== NOTE_INDEX)
}

describe('review_comment_round.body_of — the note follows the session language', () => {
	it.each(['', 'ja'])('writes the note in Japanese when the language is "%s"', (lang) => {
		const body = body_in(lang)

		expect(body).toContain(JAPANESE_NOTE_MARK)
		expect(body).not.toContain(ENGLISH_NOTE_MARK)
	})

	it('writes the note in English when the language is en', () => {
		const body = body_in('en')

		expect(body).toContain(ENGLISH_NOTE_MARK)
		expect(body).not.toContain(JAPANESE_NOTE_MARK)
	})

	it('keeps the heading and the fenced ledger lines the same in either language', () => {
		expect(without_note(body_in('ja'))).toStrictEqual(without_note(body_in('en')))
		expect(body_in('ja').startsWith(HEADING)).toBe(true)
	})
})

describe('review_comment_round.lines_of — a round of either language', () => {
	it.each(['ja', 'en'])('reads the same ledger lines from a round written in %s', async (lang) => {
		const comment = { body: body_in(lang), author_association: OWNER }

		expect(await review_comment_round.lines_of([comment])).toStrictEqual(ROUND)
	})
})

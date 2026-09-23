import { describe, expect, it } from 'vitest'
import { reply_language } from './reply-language'

const ENGLISH = 'The gate passed and the pull request is open; the review found nothing to fix.'
const JAPANESE = 'ゲートは通過し、PR を作成しました。レビューで修正すべき指摘はありませんでした。'
const JAPANESE_WITH_IDENTIFIERS =
	'Stop hook の block reason に session language の指示を追加しました。\nIssue の受け入れ条件はすべて満たしています。'
// cspell:disable-next-line
const RUSSIAN = 'Проверка пройдена, запрос на слияние открыт, замечаний к исправлению нет.'

describe('reply_language.is_mismatch — a reply in another script', () => {
	it.each([
		['ja', ENGLISH],
		['ja', RUSSIAN],
		['en', JAPANESE],
		['ru', ENGLISH],
	])('flags a %s session answered in another script', (lang, message) => {
		expect(reply_language.is_mismatch(message, lang)).toBe(true)
	})

	it('flags a mostly English reply with one Japanese line', () => {
		expect(reply_language.is_mismatch(`${ENGLISH}\n${ENGLISH}\n${JAPANESE}`, 'ja')).toBe(true)
	})
})

describe('reply_language.is_mismatch — a reply in the session language', () => {
	it.each([
		['ja', JAPANESE],
		['ja-JP', JAPANESE],
		['ja', JAPANESE_WITH_IDENTIFIERS],
		['en', ENGLISH],
		['ru', RUSSIAN],
	])('passes a %s session answered in its own script', (lang, message) => {
		expect(reply_language.is_mismatch(message, lang)).toBe(false)
	})

	it('passes a Japanese reply beside one plain English result line', () => {
		const message =
			'ゲートは通りました。\nAll 4 checks passed: lint, types, spelling and unit tests.'

		expect(reply_language.is_mismatch(message, 'ja')).toBe(false)
	})

	it('ignores bare paths printed outside backticks', () => {
		const message = `${JAPANESE}\n/Users/someone/Development/kit/scripts/rules/reply-language.ts\n/Users/someone/Development/kit/scripts/rules/stop-rules.ts`

		expect(reply_language.is_mismatch(message, 'ja')).toBe(false)
	})

	it('gives short English headings no vote against the prose', () => {
		const message = `**Cause**\n${JAPANESE}\n**Fix**\n${JAPANESE}\n**Result**\n## Details`

		expect(reply_language.is_mismatch(message, 'ja')).toBe(false)
	})

	it('reads a Common-script letter as no other language', () => {
		const message = 'The hook now answers in forty µs on average, well under its budget.'

		expect(reply_language.is_mismatch(message, 'en')).toBe(false)
	})

	it('ignores code blocks, inline code and URLs when judging', () => {
		const message = `${JAPANESE}\n\`\`\`\nThe gate passed and nothing needs fixing here.\n\`\`\`\n\`a long English inline code span\` https://example.com/english/words/here`

		expect(reply_language.is_mismatch(message, 'ja')).toBe(false)
	})
})

describe('reply_language.is_mismatch — nothing to judge', () => {
	it('passes a reply too short to carry a language', () => {
		expect(reply_language.is_mismatch('Released the hold.', 'ja')).toBe(false)
	})

	it('passes a code-only reply', () => {
		expect(reply_language.is_mismatch('```\npnpm josh gate --watch everything\n```', 'ja')).toBe(
			false,
		)
	})

	it('passes an unparseable session language', () => {
		expect(reply_language.is_mismatch(ENGLISH, 'not a language tag!')).toBe(false)
	})

	it('derives the script from the configured language', () => {
		expect(reply_language.script_of('ja')).toBe('Jpan')
		expect(reply_language.script_of('en')).toBe('Latn')
	})
})

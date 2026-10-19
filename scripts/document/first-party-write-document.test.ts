import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#4176: a run asked for confirmation before commenting `@dependabot rebase` on its own
// repository's PR, calling it an "external write". `upstream-interrupt.md` now states that writes to
// first-party Issues and PRs need no confirmation and reserves the term for third-party writes, while
// third-party writes stay Tier C.

const UPSTREAM = 'prompts/collaboration-workflow/upstream-interrupt.md'
const FIRST_PARTY_HEADING = '### first-party の Issue・PR への書き込みは確認不要'
const THIRD_PARTY_HEADING = '### 第三者リポジトリへの書き込みは Tier C（明示指示が必要）'
const TERM_SCOPE = '「外部への書き込み」は third-party への書き込みだけを指す'

function first_party_section(content: string): string {
	const start = content.indexOf(FIRST_PARTY_HEADING)

	return content.slice(start, content.indexOf(THIRD_PARTY_HEADING, start))
}

describe(`${UPSTREAM} — first-party writes need no confirmation`, () => {
	const content = read_unwrapped(UPSTREAM)
	const section = first_party_section(content)

	it('carries the first-party section before the third-party one', () => {
		expect(content.indexOf(FIRST_PARTY_HEADING)).toBeGreaterThan(-1)
		expect(content.indexOf(FIRST_PARTY_HEADING)).toBeLessThan(content.indexOf(THIRD_PARTY_HEADING))
	})

	it.each(['Tier A', '起票', 'コメント', 'ラベル', '本文の編集', '`@dependabot rebase`'])(
		'names %s as a first-party write',
		(marker) => {
			expect(section).toContain(marker)
		},
	)

	it('decides the party with the command', () => {
		expect(section).toContain('`pnpm josh repo:party`')
	})

	it('reserves "external write" for third-party writes', () => {
		expect(section).toContain(TERM_SCOPE)
	})

	it('leaves unasked observation filing to observation-filing.md', () => {
		expect(section).toContain('頼まれていない観察の起票はこの節で許可しない')
		expect(section).toContain('observation-filing.md')
	})

	it('does not license a write when the party is unknown', () => {
		expect(section).toContain('`unknown` はこの節の対象外')
	})

	it('keeps shared-state operations at Tier C', () => {
		expect(section).toContain('Tier C のまま')
	})

	it('keeps every third-party write at Tier C', () => {
		expect(content).toContain('**third-party への書き込みは種別を問わず Tier C**')
	})
})

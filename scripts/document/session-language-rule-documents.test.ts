import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#7697: the English-only item for script strings once read as covering the prose
// of a script-posted comment, so scripts hard-coded English comments for a `ja` developer.
const OVERVIEW = 'prompts/collaboration-workflow/overview.md'
const RATIONALE = 'docs/maintainers/overview-rationale.md'

describe('the session-language rule for script-emitted text', () => {
	it('limits the English-only script item to standard output and excludes posted-comment prose', () => {
		const overview = read_unwrapped(OVERVIEW)

		expect(overview).toContain(
			'3. スクリプトの標準出力と Telegram の固定文字列（投稿コメントの説明文は含まない。次の行に従う）',
		)
		expect(overview).toContain('人が読む説明文を設定言語で書く')
	})

	it('grounds posted-comment prose in session_language instead of denying a translation mechanism', () => {
		const rationale = read_unwrapped(RATIONALE)

		expect(rationale).not.toContain('no translation mechanism')
		expect(rationale).toContain('`JOSH_SESSION_LANG` through `session_language`')
	})
})

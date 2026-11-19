import { describe, expect, it } from 'vitest'
import { documentation_pages, has_japanese_prose, read_document } from './ai-document-fixture'

// joshuafolkken/kit#7686: every page under `docs/` is written in English. The pages listed here are
// not translated yet and pass only while they still carry Japanese prose, so a translated page has
// to leave the list; joshuafolkken/kit#7687 translates the rest and removes it.
const UNTRANSLATED: ReadonlyArray<string> = [
	'docs/environment-variables.md',
	'docs/josh-commands-backlog.md',
	'docs/josh-commands-board.md',
	'docs/josh-commands-run.md',
	'docs/josh-startup-telemetry.md',
	'docs/observation-waits.md',
	'docs/overview.md',
]

const QUOTED: ReadonlyArray<string> = [
	'See `wip-cap.md` → "規則" and `## 背景`.',
	'See [the rule](principles.md#consult-vs-execute--相談と実行を区別する).',
]

const PROSE: ReadonlyArray<string> = ['The 規則 section.', 'See [相談と実行](principles.md#rule).']

function translated_documents(): Array<string> {
	return documentation_pages().filter((path) => !UNTRANSLATED.includes(path))
}

describe('the docs language', () => {
	it.each(translated_documents())('%s carries no Japanese prose', (path) => {
		expect(has_japanese_prose(read_document(path))).toBe(false)
	})

	it.each(UNTRANSLATED)(
		'%s still carries Japanese prose, or leaves the untranslated list',
		(path) => {
			expect(has_japanese_prose(read_document(path))).toBe(true)
		},
	)

	it.each(QUOTED)('reads the Japanese in %s as a quote', (text) => {
		expect(has_japanese_prose(text)).toBe(false)
	})

	it.each(PROSE)('reads the Japanese in %s as prose', (text) => {
		expect(has_japanese_prose(text)).toBe(true)
	})
})

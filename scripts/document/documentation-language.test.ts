import { describe, expect, it } from 'vitest'
import { documentation_pages, has_japanese_prose, read_document } from './ai-document-fixture'

// joshuafolkken/kit#7686, #7687: every page under `docs/` is written in English, with no exceptions.
const QUOTED: ReadonlyArray<string> = [
	'See `wip-cap.md` → "規則" and `## 背景`.',
	'See [the rule](principles.md#consult-vs-execute--相談と実行を区別する).',
]

const PROSE: ReadonlyArray<string> = ['The 規則 section.', 'See [相談と実行](principles.md#rule).']

describe('the docs language', () => {
	it.each(documentation_pages())('%s carries no Japanese prose', (path) => {
		expect(has_japanese_prose(read_document(path))).toBe(false)
	})

	it.each(QUOTED)('reads the Japanese in %s as a quote', (text) => {
		expect(has_japanese_prose(text)).toBe(false)
	})

	it.each(PROSE)('reads the Japanese in %s as prose', (text) => {
		expect(has_japanese_prose(text)).toBe(true)
	})
})

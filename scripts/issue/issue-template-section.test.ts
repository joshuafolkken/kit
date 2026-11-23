import { existsSync } from 'node:fs'
import { section_reference_resolution } from '#scripts/document/section-reference-fixture'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { issue_template_section, type PointedSection } from './issue-template-section'

vi.mock(import('node:fs'), async (load_original) => {
	const original = await load_original()

	return { ...original, existsSync: vi.fn(original.existsSync) }
})

const DOCUMENT = [
	'## Step 1',
	'',
	'````md',
	'## 現象',
	'',
	'<現在の問題>',
	'',
	'## 再現',
	'',
	'```',
	'## not a heading',
	'```',
	'',
	'````',
	'',
	'## 現象 outside',
].join('\n')

describe('issue_template_section.section_of', () => {
	it('cuts a section from the fenced template', () => {
		expect(issue_template_section.section_of(DOCUMENT, '## 現象')).toBe('## 現象\n\n<現在の問題>')
	})

	it('keeps a fenced block inside the section whole', () => {
		expect(issue_template_section.section_of(DOCUMENT, '## 再現')).toBe(
			'## 再現\n\n```\n## not a heading\n```',
		)
	})

	it('answers undefined for a heading the template lacks', () => {
		expect(issue_template_section.section_of(DOCUMENT, '## 期待効果')).toBeUndefined()
	})

	it('answers undefined for a document with no template fence', () => {
		expect(issue_template_section.section_of('## 現象\n\ntext\n', '## 現象')).toBeUndefined()
	})
})

describe('issue_template_section.section (issue-template.md)', () => {
	it.each(['## 背景', '## 現象', '## 期待結果', '## 受け入れ条件', '## 期待効果'])(
		'reads %s from the shipped template',
		(heading) => {
			expect(issue_template_section.section(heading)).toMatch(
				new RegExp(String.raw`^${heading}\n\n\S`, 'u'),
			)
		},
	)

	it('answers undefined when the package ships no template', () => {
		vi.mocked(existsSync).mockReturnValueOnce(false)

		expect(issue_template_section.section('## 現象')).toBeUndefined()
	})
})

const LANG_KEY = 'JOSH_SESSION_LANG'
const ENGLISH_BACKGROUND = '## Background'

describe('issue_template_section.section (issue-template.en.md)', () => {
	afterEach(() => {
		vi.unstubAllEnvs()
	})

	it.each([ENGLISH_BACKGROUND, '## Symptom', '## Expected result', '## Acceptance criteria'])(
		'reads %s from the English template when the session language is en',
		(heading) => {
			vi.stubEnv(LANG_KEY, 'en')

			expect(issue_template_section.section(heading)).toMatch(
				new RegExp(String.raw`^${heading}\n\n\S`, 'u'),
			)
		},
	)

	it('does not read the English template when the session language is ja', () => {
		vi.stubEnv(LANG_KEY, 'ja')

		expect(issue_template_section.section(ENGLISH_BACKGROUND)).toBeUndefined()
	})
})

const POINTED_KEYS = Object.keys(issue_template_section.POINTED_SECTIONS) as Array<PointedSection>

describe('issue_template_section.pointer', () => {
	it.each(POINTED_KEYS)('cites the %s section as a reference doc:section resolves', (key) => {
		const pointer = issue_template_section.pointer(key)

		expect(pointer).toMatch(/^`issue-template\.md` → "/u)
		expect(section_reference_resolution.broken_section_references(pointer)).toStrictEqual([])
	})
})

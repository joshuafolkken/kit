import { existsSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import { issue_template_section } from './issue-template-section'

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

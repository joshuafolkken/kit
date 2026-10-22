import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { document_section } from '#scripts/document/document-section'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#4477: measurement follow-up Issues picked K as 5, 10, 25 or 30 with no tie to
// what they measured. The section now names one basis per kind of value, so a filer reads K off it.

const MEASUREMENT = 'prompts/collaboration-workflow/measurement.md'
const HEADING = '効果を測る後続 Issue'
const BASES = [
	'事象の回数の率',
	'K ≥ 10 ÷ 変更前の率',
	'連続値の平均・差',
	'5〜10',
	'最大値・裾',
	'変更前の標本数と同程度',
]

describe('the sample count K of a measurement follow-up Issue', () => {
	const section = document_section.section(read_repo_file(MEASUREMENT), HEADING)?.text ?? ''

	it('measurement.md carries the section', () => {
		expect(section).not.toBe('')
	})

	it.each(BASES)('the section names "%s"', (basis) => {
		expect(section).toContain(basis)
	})
})

import { section_reference_resolution } from '#scripts/document/section-reference-fixture'
import { describe, expect, it } from 'vitest'
import { report_format_reference } from './report-format-reference'

const HEADINGS: ReadonlyArray<string> = [
	report_format_reference.SUMMARY_RULES_HEADING,
	report_format_reference.SUMMARY_TEMPLATE_HEADING,
	report_format_reference.COMPLETION_REPORT_HEADING,
	report_format_reference.ACCEPTANCE_MAP_HEADING,
	report_format_reference.REMOVED_TESTS_HEADING,
]

describe('report_format_reference.pointer', () => {
	it.each(HEADINGS)('resolves to a real section: %s', (heading) => {
		const text = report_format_reference.pointer(heading)

		expect(section_reference_resolution.broken_section_references(text)).toEqual([])
	})

	it('names the document and the heading in the section-reference form', () => {
		const text = report_format_reference.pointer(report_format_reference.SUMMARY_RULES_HEADING)

		expect(text).toContain(
			`${report_format_reference.REPORT_FORMAT_PATH} → "${report_format_reference.SUMMARY_RULES_HEADING}"`,
		)
	})

	it('single-quotes the heading in the runnable command so backticks are not substituted', () => {
		const text = report_format_reference.pointer(report_format_reference.SUMMARY_TEMPLATE_HEADING)

		expect(text).toContain(
			`pnpm josh doc:section ${report_format_reference.REPORT_FORMAT_PATH} '${report_format_reference.SUMMARY_TEMPLATE_HEADING}'`,
		)
	})

	it('builds from the heading it is given', () => {
		expect(report_format_reference.pointer('Some heading')).toContain('"Some heading"')
	})
})

describe('report_format_reference.child_summary_pointer', () => {
	it('resolves to a real section in the backlogrun child document', () => {
		const text = report_format_reference.child_summary_pointer()

		expect(text).toContain(
			`${report_format_reference.CHILD_SUMMARY_PATH} → "${report_format_reference.CHILD_SUMMARY_HEADING}"`,
		)
		expect(section_reference_resolution.broken_section_references(text)).toEqual([])
	})
})

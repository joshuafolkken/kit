import { document_section } from '#scripts/document/document-section'
import { document_section_cli } from '#scripts/document/document-section-cli'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { run_step_section_driver } from './run-step-section-driver'
import { run_step_section_table } from './run-step-section-table'

afterEach(() => {
	vi.restoreAllMocks()
})

function resolves(document: string, heading: string): boolean {
	const markdown = document_section.read_optional(document_section_cli.resolve_document(document))

	return markdown !== undefined && document_section.section(markdown, heading) !== undefined
}

// joshuafolkken/kit#5920: a `backlog:drive` hand-off carries these sections' text.
describe('run_step_section_driver — the sections a driver hand-off carries', () => {
	it.each(
		run_step_section_table.DRIVER_SECTIONS.flatMap(([prefix, sections]) =>
			sections.map((section) => [prefix, section] as const),
		),
	)('resolves the %s driver row against the shipped documents', (_prefix, reference) => {
		expect(resolves(reference.document, reference.heading)).toBe(true)
	})

	it('names a driver section it cannot resolve rather than dropping it', () => {
		vi.spyOn(document_section_cli, 'section_text').mockReturnValue(undefined)

		expect(run_step_section_driver.driver_sections('judge')).toContain(
			'`docs/josh-commands-backlog.md` → "`josh auto-ok:judge`"',
		)
	})

	it('carries "The loop" for a verdict with no row of its own', () => {
		expect(run_step_section_driver.driver_sections('offer')).toBe(
			document_section_cli.section_text('backlogrun-steps.md', 'The loop'),
		)
	})
})

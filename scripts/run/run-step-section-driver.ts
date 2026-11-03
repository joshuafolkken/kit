import { document_section_cli } from '#scripts/document/document-section-cli'
import { run_step_section_table, type SectionReference } from './run-step-section-table'

// The text a `backlog:drive` hand-off carries (joshuafolkken/kit#5920), apart from the printing in
// `run-step-section.ts` (joshuafolkken/kit#5987): the wake driver needs no print, so a change to the
// printing never reaches its tests.

const { DRIVER_SECTIONS, LOOP } = run_step_section_table

// A section that does not resolve — a document a consumer does not ship — is named instead of
// failing the hand-off; the table's test keeps every row resolving in kit.
function carried_text(found: SectionReference, root: string): string {
	return (
		document_section_cli.section_text(found.document, found.heading, root) ??
		`\`${found.document}\` → "${found.heading}"`
	)
}

function driver_sections(verdict: string, root: string = process.cwd()): string {
	const found = DRIVER_SECTIONS.find(([prefix]) => verdict.startsWith(prefix))

	return (found?.[1] ?? [LOOP]).map((section) => carried_text(section, root)).join('\n')
}

const run_step_section_driver = { driver_sections }

export { run_step_section_driver }

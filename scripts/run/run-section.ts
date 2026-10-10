// The section report the composite commands share — `run:tail` and `ship` each run a fixed chain of
// steps and print every step's output under its own header. The section shape, the join and the
// clean/red verdict read off the collected codes are the same in both, so they live here once; what a
// composite adds on top (ship's `stopped at:` line, tail's stderr fold) stays in its own module.

const SECTION_SEPARATOR = '\n\n'

const SUCCESS_EXIT_CODE = 0
const FAILURE_EXIT_CODE = 1

interface Section {
	header: string
	body: string
	code: number
}

function section_report(section: Section): string {
	return `${section.header}\n${section.body}`
}

function format_sections(sections: ReadonlyArray<Section>): string {
	return sections.map((section) => section_report(section)).join(SECTION_SEPARATOR)
}

// Non-zero when any step failed, exactly as each step exits on its own — a bundle where one step
// failed is never read as clean because the steps around it succeeded.
function exit_code_of(sections: ReadonlyArray<Section>): number {
	const is_clean = sections.every((section) => section.code === SUCCESS_EXIT_CODE)

	return is_clean ? SUCCESS_EXIT_CODE : FAILURE_EXIT_CODE
}

const run_section = {
	FAILURE_EXIT_CODE,
	SECTION_SEPARATOR,
	SUCCESS_EXIT_CODE,
	exit_code_of,
	format_sections,
}

export type { Section }
export { run_section }

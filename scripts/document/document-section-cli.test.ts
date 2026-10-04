import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { bash_output_cap_reader } from './bash-output-cap'
import { capped_print_fixture } from './capped-print-fixture'
import { document_section } from './document-section'
import { document_section_cli } from './document-section-cli'

// `josh doc:section` on the two sections that overflowed the Bash output cap most often on one day
// (joshuafolkken/kit#3143): each is now delivered under the cap, and whole.

const SUCCESS = 0
const ROOT = process.cwd()
const DOCUMENT = 'backlogrun-steps.md'
const HEADINGS = ['The session cut is inside the invocation', 'The loop'] as const

const info_mock = vi.fn()

function printed(): string {
	return info_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

function section_text(heading: string): string | undefined {
	const markdown = document_section.read_optional(
		path.join(ROOT, '.claude', 'skills', 'workflow-commands', DOCUMENT),
	)

	return document_section.section(markdown ?? '', heading)?.text
}

beforeEach(() => {
	info_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(info_mock)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe.each(HEADINGS)('josh doc:section %s', (heading) => {
	it('prints nothing a single read past the Bash output cap', () => {
		expect(document_section_cli.run([DOCUMENT, heading], ROOT)).toBe(SUCCESS)
		expect(capped_print_fixture.largest_read(printed())).toBeLessThanOrEqual(
			bash_output_cap_reader.bash_output_cap(ROOT),
		)
	})

	it('delivers the section verbatim', () => {
		document_section_cli.run([DOCUMENT, heading], ROOT)

		expect(capped_print_fixture.restored(printed())).toBe(section_text(heading))
	})
})

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const resolve_mock = vi.hoisted(() => vi.fn())
const read_optional_mock = vi.hoisted(() => vi.fn())
const cap_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const error_mock = vi.hoisted(() => vi.fn())

vi.mock('./document-section-cli', () => ({
	document_section_cli: { resolve_document: resolve_mock },
}))

vi.mock('./document-section', () => ({
	document_section: { read_optional: read_optional_mock },
}))

vi.mock('./bash-output-cap', () => ({
	bash_output_cap_reader: { bash_output_cap: cap_mock },
}))

const { document_read_cli } = await import('./document-read-cli')

const SUCCESS = 0
const FAILURE = 1
const CAP = 20
const PATH = '/repo/CLAUDE.md'
const SMALL = 'a short line'
const LARGE = 'x'.repeat(CAP + 1)

function printed(): string {
	return info_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

function reported(): string {
	return error_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

beforeEach(() => {
	resolve_mock.mockReset()
	read_optional_mock.mockReset()
	cap_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
	info_mock.mockReset()
	error_mock.mockReset()
	resolve_mock.mockReturnValue(PATH)
	cap_mock.mockReturnValue(CAP)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('document_read_cli.run', () => {
	it('prints a document that fits under the cap', () => {
		read_optional_mock.mockReturnValue(SMALL)

		expect(document_read_cli.run([PATH])).toBe(SUCCESS)
		expect(printed()).toBe(SMALL)
	})

	it('prints a directive and no content when the document is over the cap', () => {
		read_optional_mock.mockReturnValue(LARGE)

		expect(document_read_cli.run([PATH])).toBe(SUCCESS)

		const out = printed()

		expect(out).toContain(document_read_cli.OVER_CAP_PREFIX)
		expect(out).toContain(document_read_cli.READ_TOOL_DIRECTIVE)
		expect(out).toContain(PATH)
		expect(out).not.toContain(LARGE)
	})

	it('exits non-zero when the file cannot be read', () => {
		read_optional_mock.mockReturnValue(undefined)

		expect(document_read_cli.run([PATH])).toBe(FAILURE)
		expect(reported()).toContain('Cannot read')
	})

	it('refuses a missing file argument', () => {
		expect(document_read_cli.run([])).toBe(FAILURE)
		expect(reported()).toContain('Usage')
	})
})

describe('document_read_cli.over_cap_directive', () => {
	it('names both byte figures and the path, carrying no file content', () => {
		const line = document_read_cli.over_cap_directive(PATH, 9000, 8000)

		expect(line).toContain('9,000 B')
		expect(line).toContain('8,000 B')
		expect(line).toContain(PATH)
	})
})

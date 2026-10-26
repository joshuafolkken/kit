import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { command_reference_line_budget } from './command-reference-line-budget'
import { document_ratchet_check } from './document-ratchet-check'
import { issue_citation_budget } from './issue-citation-budget'

const { MAX_LONG_LINES } = command_reference_line_budget
const { recorded_citations_for } = issue_citation_budget

const LONG_LINE = 'x'.repeat(401)
const REFERENCE_PAGE = 'docs/josh-commands.md'
const CITING_PAGE = 'docs/josh-commands-run.md'
const UNRELATED_FILE = 'scripts/unrelated.ts'

// One scratch root, emptied after every case.
const root = mkdtempSync(path.join(tmpdir(), 'document-ratchet-check-'))

function write(relative_path: string, text: string): string {
	const absolute_path = path.join(root, relative_path)

	mkdirSync(path.dirname(absolute_path), { recursive: true })
	writeFileSync(absolute_path, text)

	return absolute_path
}

function citations(count: number): string {
	return Array.from({ length: count }, (_, index) => `#${(1000 + index).toString()}`).join(' ')
}

function written_output(): string {
	return vi
		.mocked(process.stdout.write)
		.mock.calls.map((call) => String(call[0]))
		.join('')
}

beforeEach(() => {
	mkdirSync(root, { recursive: true })
	vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
})

afterEach(() => {
	rmSync(root, { recursive: true, force: true })
	vi.restoreAllMocks()
})

describe('document_ratchet_check.check_files', () => {
	it('fails a changed command reference page with more long lines than the ceiling', () => {
		const lines = Array.from({ length: MAX_LONG_LINES + 1 }, () => LONG_LINE).join('\n')
		const changed = write(REFERENCE_PAGE, lines)

		expect(document_ratchet_check.check_files(root, [changed])).toBe(1)
		expect(written_output()).toContain(REFERENCE_PAGE)
		expect(written_output()).toContain(`has ${(MAX_LONG_LINES + 1).toString()} lines`)
	})

	it('fails a changed document whose citations moved off its recorded count', () => {
		const recorded = recorded_citations_for(CITING_PAGE)
		const changed = write(CITING_PAGE, citations(recorded + 1))

		expect(document_ratchet_check.check_files(root, [changed])).toBe(1)
		expect(written_output()).toContain(
			`${CITING_PAGE} cites ${(recorded + 1).toString()} issue numbers, over its ceiling of ${recorded.toString()}`,
		)
	})

	it('passes a changed document that holds its recorded count', () => {
		const changed = write(CITING_PAGE, citations(recorded_citations_for(CITING_PAGE)))

		expect(document_ratchet_check.check_files(root, [changed])).toBe(0)
		expect(written_output()).toBe('')
	})

	it('reads no command reference page when the change touches none', () => {
		write(REFERENCE_PAGE, Array.from({ length: MAX_LONG_LINES + 1 }, () => LONG_LINE).join('\n'))
		const changed = write(UNRELATED_FILE, citations(1))

		expect(document_ratchet_check.check_files(root, [changed])).toBe(0)
	})
})

describe('document_ratchet_check.check_all', () => {
	it('holds this repository at its recorded ratchets', () => {
		expect(document_ratchet_check.check_all(process.cwd())).toBe(0)
	})

	it('reports the long-line ceiling with no change handed in', () => {
		write(REFERENCE_PAGE, Array.from({ length: MAX_LONG_LINES + 1 }, () => LONG_LINE).join('\n'))

		expect(document_ratchet_check.check_all(root)).toBe(1)
	})
})

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { disposition_cli } from './disposition-cli'

// joshuafolkken/kit#2181: the CLI prints the verdict to stdout and a reason to stderr, exiting
// non-zero only on a usage error.

const CODE_FILE = 'scripts/foo.ts'
const INERT_FILE = '.editorconfig'

describe('disposition_cli.run', () => {
	it('is a usage error with no paths', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(disposition_cli.run([])).toBe(1)
		expect(error).toHaveBeenCalledWith(disposition_cli.USAGE)

		error.mockRestore()
	})

	it('exits zero and prints the verdict for named paths', () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

		expect(disposition_cli.run([CODE_FILE])).toBe(0)
		expect(write).toHaveBeenCalledWith('runtime\n')

		vi.restoreAllMocks()
	})
})

// joshuafolkken/kit#5542: `--batch <findings-file>` prints the routing table; a bare path stays the
// single-finding call it was.
const BATCH_FLAG = '--batch'
const UNPARSED_LINE = 'not a finding'

function findings_file(content: string): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'disposition-batch-'))
	const file = path.join(directory, 'findings.txt')

	writeFileSync(file, content)

	return file
}

describe('disposition_cli.run --batch', () => {
	it('prints the routing table for a findings file', () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)
		const file = findings_file(`comments:low:${INERT_FILE} — a stale comment\n`)

		expect(disposition_cli.run([BATCH_FLAG, file])).toBe(0)
		expect(String(write.mock.calls[0]?.[0])).toContain('| non-runtime | no | drop |')

		vi.restoreAllMocks()
	})

	it('is a usage error with no findings file', () => {
		vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(disposition_cli.run([BATCH_FLAG])).toBe(1)

		vi.restoreAllMocks()
	})

	it('refuses a line outside the review:record grammar', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		expect(disposition_cli.run([BATCH_FLAG, findings_file(`${UNPARSED_LINE}\n`)])).toBe(1)
		expect(String(error.mock.calls[0]?.[0])).toContain(UNPARSED_LINE)

		vi.restoreAllMocks()
	})

	// joshuafolkken/kit#5583: a finding routed to `file` drafts a body that cites the review's issue.
	it('refuses a file-routed finding without --found-during', () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const file = findings_file(`confirmed bug-risks:medium:${CODE_FILE} — a null deref\n`)

		expect(disposition_cli.run([BATCH_FLAG, file])).toBe(1)
		expect(String(error.mock.calls[0]?.[0])).toContain('--found-during')

		vi.restoreAllMocks()
	})

	it('keeps a bare path the single-finding call', () => {
		const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true)

		vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

		expect(disposition_cli.run([INERT_FILE])).toBe(0)
		expect(write).toHaveBeenCalledWith('non-runtime\n')

		vi.restoreAllMocks()
	})
})

describe('disposition_cli.reason_line', () => {
	it('names the reaching paths', () => {
		expect(disposition_cli.reason_line([INERT_FILE, CODE_FILE])).toContain(CODE_FILE)
	})

	it('says the finding is inert when no path reaches', () => {
		expect(disposition_cli.reason_line([INERT_FILE])).toContain('inert')
	})
})

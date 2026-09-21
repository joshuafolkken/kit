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

describe('disposition_cli.reason_line', () => {
	it('names the reaching paths', () => {
		expect(disposition_cli.reason_line([INERT_FILE, CODE_FILE])).toContain(CODE_FILE)
	})

	it('says the finding is inert when no path reaches', () => {
		expect(disposition_cli.reason_line([INERT_FILE])).toContain('inert')
	})
})

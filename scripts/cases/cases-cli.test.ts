import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { cases_cli } from './cases-cli'

// joshuafolkken/kit#2246: the CLI prints the boundary tokens on stdout and the required cases on
// stderr, and answers `none` with a clean exit when no boundary is crossed.

const directory = mkdtempSync(path.join(tmpdir(), 'cases-cli-'))
const NETWORK_PATH = path.join(directory, 'net.ts')
const INERT_PATH = path.join(directory, 'pure.ts')

writeFileSync(NETWORK_PATH, 'await fetch(url)\n', 'utf8')
writeFileSync(INERT_PATH, 'export const x = 1\n', 'utf8')

afterAll(() => {
	rmSync(directory, { recursive: true, force: true })
})

function capture_stdout(argv: ReadonlyArray<string>): { code: number; out: string } {
	const lines: Array<string> = []
	const info_spy = vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
		lines.push(String(line))
	})
	const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

	try {
		return { code: cases_cli.run(argv), out: lines.join('\n') }
	} finally {
		info_spy.mockRestore()
		error_spy.mockRestore()
	}
}

describe('cases_cli.run', () => {
	it('prints the boundary token for a crossing change', () => {
		expect(capture_stdout([NETWORK_PATH])).toEqual({ code: 0, out: 'network' })
	})

	it('prints none for a change that crosses no boundary', () => {
		expect(capture_stdout([INERT_PATH])).toEqual({ code: 0, out: 'none' })
	})

	it('fails with a usage line when no path is given', () => {
		const error_spy = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		try {
			expect(cases_cli.run([])).toBe(1)
		} finally {
			error_spy.mockRestore()
		}
	})
})

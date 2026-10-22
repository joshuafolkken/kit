import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { cases_cli } from './cases-cli'

// joshuafolkken/kit#2246: the CLI prints the boundary tokens on stdout and the required cases on
// stderr, and answers `none` with a clean exit when no boundary is crossed. joshuafolkken/kit#4491: the
// interaction tokens join the stdout line, and their lines lead stderr.

const directory = mkdtempSync(path.join(tmpdir(), 'cases-cli-'))
const NETWORK_PATH = path.join(directory, 'net.ts')
const ENVIRONMENT_PATH = path.join(directory, 'env.ts')
const INERT_PATH = path.join(directory, 'pure.ts')

writeFileSync(NETWORK_PATH, 'await fetch(url)\n', 'utf8')
writeFileSync(ENVIRONMENT_PATH, "await fetch(process.env['API_URL'])\n", 'utf8')
writeFileSync(INERT_PATH, 'export const x = 1\n', 'utf8')

afterAll(() => {
	rmSync(directory, { recursive: true, force: true })
})

async function capture(
	argv: ReadonlyArray<string>,
): Promise<{ code: number; out: string; err: ReadonlyArray<string> }> {
	const lines: Array<string> = []
	const errors: Array<string> = []
	const info_spy = vi.spyOn(console, 'info').mockImplementation((line: unknown) => {
		lines.push(String(line))
	})
	const error_spy = vi.spyOn(console, 'error').mockImplementation((line: unknown) => {
		errors.push(String(line))
	})

	try {
		return { code: await cases_cli.run(argv), out: lines.join('\n'), err: errors }
	} finally {
		info_spy.mockRestore()
		error_spy.mockRestore()
	}
}

describe('cases_cli.run', () => {
	it('prints the boundary token for a crossing change', async () => {
		const { code, out } = await capture([NETWORK_PATH])

		expect({ code, out }).toEqual({ code: 0, out: 'network' })
	})

	it('prints none for a change that crosses no boundary', async () => {
		const { code, out } = await capture([INERT_PATH])

		expect({ code, out }).toEqual({ code: 0, out: 'none' })
	})

	it('adds the env token and leads stderr with the variable line', async () => {
		const { out, err } = await capture([ENVIRONMENT_PATH])

		expect(out).toBe('network env')
		expect(err[0]).toContain('`API_URL`')
		expect(err[1]).toContain('required abnormal cases:')
	})

	it('fails with a usage line when no path is given', async () => {
		const { code } = await capture([])

		expect(code).toBe(1)
	})
})

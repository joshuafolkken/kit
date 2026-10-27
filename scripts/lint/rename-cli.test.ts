import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import ts from 'typescript'
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { rename_cli } from './rename-cli'

const TOUCHED = "import { old } from './old'\n\nold()\n"
const UNTOUCHED = 'const other = 1\n'
const FAILURE_EXIT_CODE = 1

const directory = mkdtempSync(path.join(tmpdir(), 'rename-cli-'))

function file_with(name: string, text: string): string {
	const file = path.join(directory, name)

	writeFileSync(file, text)

	return file
}

async function no_format(): Promise<void> {
	await Promise.resolve()
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockReturnValue()
	vi.spyOn(console, 'error').mockReturnValue()
})

afterEach(() => {
	vi.restoreAllMocks()
})

afterAll(() => {
	rmSync(directory, { recursive: true, force: true })
})

describe('rename_cli.run — writes', () => {
	it('renames the identifier and the specifier, printing each file count', async () => {
		const file = file_with('a.ts', TOUCHED)
		const argv = ['old', 'renamed', '--import', './old', './renamed', file]

		expect(await rename_cli.run(argv, ts, no_format)).toBe(0)
		expect(readFileSync(file, 'utf8')).toBe("import { renamed } from './renamed'\n\nrenamed()\n")
		expect(console.info).toHaveBeenCalledWith(`${file}: 3`)
	})

	it('hands every written file to the formatter', async () => {
		const file = file_with('a.ts', TOUCHED)
		const formatter = vi.fn(no_format)

		await rename_cli.run(['old', 'renamed', file], ts, formatter)

		expect(formatter).toHaveBeenCalledWith([file])
	})
})

describe('rename_cli.run — refuses', () => {
	it('names a file with no replacement, exits 1 and writes nothing', async () => {
		const touched = file_with('a.ts', TOUCHED)
		const untouched = file_with('b.ts', UNTOUCHED)

		expect(await rename_cli.run(['old', 'renamed', touched, untouched], ts, no_format)).toBe(
			FAILURE_EXIT_CODE,
		)
		expect(readFileSync(touched, 'utf8')).toBe(TOUCHED)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(untouched))
	})

	it('names a missing file and exits 1', async () => {
		const missing = path.join(directory, 'missing.ts')

		expect(await rename_cli.run(['old', 'renamed', missing], ts, no_format)).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(missing))
	})

	it('names a file the TypeScript parser does not read whole and exits 1', async () => {
		const svelte = file_with('a.svelte', TOUCHED)

		expect(await rename_cli.run(['old', 'renamed', svelte], ts, no_format)).toBe(FAILURE_EXIT_CODE)
		expect(readFileSync(svelte, 'utf8')).toBe(TOUCHED)
		expect(console.error).toHaveBeenCalledWith(expect.stringContaining(svelte))
	})

	it.each([
		['no file', ['old', 'renamed']],
		['an identifier that is not one', ['old', 'not-a-name', 'a.ts']],
		['an --import with one specifier', ['old', 'renamed', 'a.ts', '--import', './old']],
	])('prints the usage on %s', async (_label, argv) => {
		expect(await rename_cli.run(argv, ts, no_format)).toBe(FAILURE_EXIT_CODE)
		expect(console.error).toHaveBeenCalledWith(rename_cli.USAGE)
	})
})

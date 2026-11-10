import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import typescript from 'typescript'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { code_symbol_cli } from './code-symbol-cli'

const SUCCESS = 0
const FIXTURE_FILE = 'fixture.ts'
const FIXTURE = [
	'// Doubles it.',
	'function twice(value: number): number {',
	'\treturn value * 2',
	'}',
].join('\n')

const make_directory = temporary_directory('suite')
const info_mock = vi.fn()
const error_mock = vi.fn()

function printed(mock: ReturnType<typeof vi.fn>): string {
	return mock.mock.calls.map((call) => String(call[0])).join('\n')
}

function fixture_root(): string {
	const directory = make_directory('code-symbol-')

	writeFileSync(path.join(directory, FIXTURE_FILE), FIXTURE)

	return directory
}

const directory = fixture_root()

beforeEach(() => {
	info_mock.mockReset()
	error_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('josh code:symbol <file> <name>', () => {
	it('prints the declaration with its comment, numbered', () => {
		expect(code_symbol_cli.run([FIXTURE_FILE, 'twice'], typescript, directory)).toBe(SUCCESS)
		expect(printed(info_mock)).toBe(
			'1\t// Doubles it.\n2\tfunction twice(value: number): number {\n3\t\treturn value * 2\n4\t}',
		)
	})

	it('refuses an undeclared name and lists what the file declares', () => {
		const code = code_symbol_cli.run([FIXTURE_FILE, 'thrice'], typescript, directory)

		expect(code).toBe(code_symbol_cli.FAILURE_EXIT_CODE)
		expect(printed(error_mock)).toContain('  twice')
	})

	it('refuses a file it cannot read', () => {
		const code = code_symbol_cli.run(['missing.ts', 'twice'], typescript, directory)

		expect(code).toBe(code_symbol_cli.FAILURE_EXIT_CODE)
	})
})

describe('josh code:symbol <name>', () => {
	it('lists the repository file:line that declares the name', () => {
		expect(code_symbol_cli.run(['josh_read_only'], typescript)).toBe(SUCCESS)
		expect(printed(info_mock)).toMatch(/^scripts\/josh\/josh-read-only\.ts:\d+$/mu)
	})

	it('exits non-zero when nothing declares the name', () => {
		const code = code_symbol_cli.run(['no_declaration_by_this_name'], typescript)

		expect(code).toBe(code_symbol_cli.FAILURE_EXIT_CODE)
	})
})

describe('josh code:symbol usage', () => {
	it.each([[[]], [['a', 'b', 'c']]])('prints usage for %j', (argv) => {
		expect(code_symbol_cli.run(argv, typescript)).toBe(code_symbol_cli.FAILURE_EXIT_CODE)
		expect(printed(error_mock)).toContain('a Svelte <script> is not read')
	})
})

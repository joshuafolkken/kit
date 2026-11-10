import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { run_prep_cli } from '#scripts/run/run-prep-cli'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { plan_scaffold } from './plan-scaffold'
import { plan_scaffold_cli } from './plan-scaffold-cli'

const ISSUE = '7145'
const PREFIX = 'plan-scaffold-cli-'
const GIVEN = 'tsconfig.json'
const create_directory = temporary_directory()

afterEach(() => {
	vi.restoreAllMocks()
})

function write(name: string, content: string, directory = create_directory(PREFIX)): string {
	const file = path.join(directory, name)

	writeFileSync(file, content)

	return file
}

describe('plan_scaffold_cli.run', () => {
	it.each([[[]], [['abc']], [['-1']]])('refuses %j with exit 1 before any read', async (argv) => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const read = vi.spyOn(run_prep_cli, 'read_summary')

		await expect(plan_scaffold_cli.run(argv)).resolves.toBe(1)
		expect(error).toHaveBeenCalledWith('Usage: josh plan:scaffold <issue-number> [<path>...]')
		expect(read).not.toHaveBeenCalled()
	})

	it('reports an unreadable issue body as a read failure, not as usage', async () => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		vi.spyOn(run_prep_cli, 'read_summary').mockResolvedValue(undefined)

		await expect(plan_scaffold_cli.run([ISSUE])).resolves.toBe(1)
		expect(error).toHaveBeenCalledWith(expect.stringContaining('unreadable'))
		expect(error).not.toHaveBeenCalledWith(expect.stringContaining('Usage'))
	})

	it.each([
		{ paths: [], expected: ['package.json'] },
		{ paths: [GIVEN], expected: [GIVEN] },
	])('plans $expected when given $paths', async ({ paths, expected }) => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		vi.spyOn(run_prep_cli, 'read_summary').mockResolvedValue({
			body: 'Edit `package.json`.',
			text: 'summary',
		})
		const format = vi.spyOn(plan_scaffold, 'format')

		await expect(plan_scaffold_cli.run([ISSUE, ...paths])).resolves.toBe(0)
		expect(format.mock.calls[0]?.[0].files).toEqual(expected)
	})
})

describe('plan_scaffold_cli.is_file', () => {
	it('accepts a regular file and rejects a directory or an absent path', () => {
		const directory = create_directory(PREFIX)
		const nested = path.join(directory, 'nested')

		mkdirSync(nested)

		expect(plan_scaffold_cli.is_file(write('a.ts', '', directory))).toBe(true)
		expect(plan_scaffold_cli.is_file(nested)).toBe(false)
		expect(plan_scaffold_cli.is_file(path.join(directory, 'absent.ts'))).toBe(false)
	})
})

describe('plan_scaffold_cli.case_lines', () => {
	it('owes nothing for a doc that crosses no boundary', async () => {
		await expect(plan_scaffold_cli.case_lines([write('a.md', '# Title\n')])).resolves.toEqual([])
	})

	it('names the boundary a source file crosses', async () => {
		const lines = await plan_scaffold_cli.case_lines([write('a.ts', 'await fetch(url)\n')])

		expect(lines[0]).toContain('network')
	})
})

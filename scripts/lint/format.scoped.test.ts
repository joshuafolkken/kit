import { readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { describe, expect, it } from 'vitest'
import { format_steps } from './format-steps'

const make_directory = temporary_directory()
const SELECTED = 'selected.js'
const NODE_MODULES = 'node_modules'
const NAMED_FUNCTION = 'function echo(argument)'
const CURLY_IF = 'if (argument) {'
const UNTOUCHED = 'untouched.js'
const BAD_SOURCE = 'function echo(arg) {if(arg) return arg;return 0;}\n'
const GATE_SENTINEL = 'gate sentinel'
const EDIT_SENTINEL = 'edit sentinel'
const README = 'README.md'
const PACKAGE_JSON = 'package.json'
const CONFIG = `import unicorn from 'eslint-plugin-unicorn'
export default [{ plugins: { unicorn }, rules: {
  curly: ['error', 'all'],
  'unicorn/name-replacements': 'error',
  'padding-line-between-statements': ['error', {blankLine:'always',prev:'*',next:'return'}]
} }]
`

function fixture(config = CONFIG): string {
	const root = make_directory('scoped-format-')

	symlinkSync(path.join(process.cwd(), NODE_MODULES), path.join(root, NODE_MODULES), 'dir')
	writeFileSync(path.join(root, PACKAGE_JSON), '{"type":"module","josh":{"profile":"full"}}')
	writeFileSync(path.join(root, 'eslint.config.js'), config)
	writeFileSync(path.join(root, SELECTED), BAD_SOURCE)
	writeFileSync(path.join(root, UNTOUCHED), BAD_SOURCE)

	return root
}

function cache_fixture(root: string): { gate_cache: string; edit_cache: string } {
	const gate_cache = path.join(root, '.eslintcache')
	const edit_cache = path.join(root, '.eslintcache.edit')

	writeFileSync(gate_cache, GATE_SENTINEL)
	writeFileSync(edit_cache, EDIT_SENTINEL)

	return { gate_cache, edit_cache }
}

function basic_fixture(): string {
	const root = fixture()

	writeFileSync(path.join(root, PACKAGE_JSON), '{"type":"module","josh":{"profile":"basic"}}')
	writeFileSync(path.join(root, README), '# Readme\n')

	return root
}

describe('format_steps.run_scoped basic profile boundaries', () => {
	it.each([{ files: [README] }, { files: [README, SELECTED] }])(
		'keeps writes inside the selected basic-profile files $files (ac-4a2d19ed)',
		async ({ files }) => {
			const root = basic_fixture()

			expect(
				await format_steps.run_scoped({ mode: 'related', files, reason: 'explicit' }, root),
			).toBe(0)
			expect(readFileSync(path.join(root, UNTOUCHED), 'utf8')).toBe(BAD_SOURCE)
			expect(readFileSync(path.join(root, README), 'utf8')).toBe('# Readme\n')
			if (files.includes(SELECTED)) {
				expect(readFileSync(path.join(root, SELECTED), 'utf8')).toContain(NAMED_FUNCTION)
			} else expect(readFileSync(path.join(root, SELECTED), 'utf8')).toBe(BAD_SOURCE)
		},
	)

	it('retains whole-tree Web formatting on a basic fallback', async () => {
		const root = basic_fixture()

		expect(
			await format_steps.run_scoped({ mode: 'all', files: [], reason: 'fallback' }, root),
		).toBe(0)
		expect(readFileSync(path.join(root, UNTOUCHED), 'utf8')).toContain(NAMED_FUNCTION)
	})
})

describe('format_steps.run_scoped with real formatters', () => {
	it('fixes curly, blank lines and naming only in the resolved file list (ac-db46a2e6)', async () => {
		const root = fixture()
		const selected = path.join(root, SELECTED)

		expect(
			await format_steps.run_scoped(
				{ mode: 'related', files: [selected], reason: 'explicit' },
				root,
			),
		).toBe(0)
		expect(readFileSync(selected, 'utf8')).toContain(NAMED_FUNCTION)
		expect(readFileSync(selected, 'utf8')).toContain(CURLY_IF)
		expect(readFileSync(selected, 'utf8')).toContain('\n\n  return 0;')
		expect(readFileSync(path.join(root, UNTOUCHED), 'utf8')).toBe(BAD_SOURCE)
	})

	it('formats the whole fallback using only the related caches (ac-4a2d19ed)', async () => {
		const root = fixture()
		const { gate_cache, edit_cache } = cache_fixture(root)

		expect(
			await format_steps.run_scoped({ mode: 'all', files: [], reason: 'fallback' }, root),
		).toBe(0)
		expect(readFileSync(path.join(root, UNTOUCHED), 'utf8')).toContain(NAMED_FUNCTION)
		expect(readFileSync(gate_cache, 'utf8')).toBe(GATE_SENTINEL)
		expect(readFileSync(edit_cache, 'utf8')).toBe(EDIT_SENTINEL)
	})
})

describe('format_steps.run_scoped residual errors', () => {
	it('keeps remaining complexity red after fixing and formatting (ac-ce159e23)', async () => {
		const root = fixture(CONFIG.replace('curly:', "complexity: ['error', 1], curly:"))
		const selected = path.join(root, SELECTED)

		expect(
			await format_steps.run_scoped(
				{ mode: 'related', files: [selected], reason: 'explicit' },
				root,
			),
		).not.toBe(0)
		expect(readFileSync(selected, 'utf8')).toContain(NAMED_FUNCTION)
		expect(readFileSync(selected, 'utf8')).toContain(CURLY_IF)
	})
})

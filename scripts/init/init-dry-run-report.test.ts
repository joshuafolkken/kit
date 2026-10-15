import { describe, expect, it } from 'vitest'
import { init_dry_run_report, type FileChange } from './init-dry-run-report'

const PACKAGE_JSON = 'package.json'
const SETTINGS_JSON = '.vscode/settings.json'
const README = 'README.md'
const TITLE = 'The setup would:'
const LIST_OF_X = '{"a":["x"]}'
const INSTALL_LINE = 'run pnpm install'

function change(file: string, before: string | undefined, after: string | undefined): FileChange {
	return { path: file, before, after }
}

describe('init_dry_run_report.changed_files', () => {
	it('lists only the paths whose content differs, sorted', () => {
		const before = new Map([
			['b.md', 'same'],
			['a.md', 'old'],
			['gone.md', 'x'],
		])
		const after = new Map([
			['b.md', 'same'],
			['a.md', 'new'],
			['new.md', 'y'],
		])

		expect(init_dry_run_report.changed_files(before, after)).toStrictEqual([
			change('a.md', 'old', 'new'),
			change('gone.md', 'x', undefined),
			change('new.md', undefined, 'y'),
		])
	})
})

describe('init_dry_run_report.change_kind', () => {
	it.each([
		['a new file', change(README, undefined, 'x'), 'create'],
		['a removed file', change(README, 'x', undefined), 'delete'],
		['a file that keeps every line', change(README, 'a\nb', 'a\nkit\nb'), 'merge'],
		['a file that loses a line', change(README, 'a\nb', 'a\nkit'), 'overwrite'],
	])('classifies %s', (_name, file_change, kind) => {
		expect(init_dry_run_report.change_kind(file_change)).toBe(kind)
	})

	it('compares JSON by value, so a reformatted file that keeps every value is a merge', () => {
		const before = '{ "name": "app", "list": ["a"], "nested": { "keep": 1 } }'
		const after = JSON.stringify(
			{ name: 'app', list: ['a', 'b'], nested: { keep: 1, more: 2 }, extra: true },
			undefined,
			'\t',
		)

		expect(init_dry_run_report.change_kind(change(SETTINGS_JSON, before, after))).toBe('merge')
	})

	it.each([
		['a changed value', '{"a":1}', '{"a":2}'],
		['a dropped list entry', '{"a":["x","y"]}', LIST_OF_X],
		['a list replaced by a value', LIST_OF_X, '{"a":"x"}'],
		['a dropped key', '{"a":1,"b":2}', '{"a":1}'],
	])('classifies JSON with %s as an overwrite', (_name, before, after) => {
		expect(init_dry_run_report.change_kind(change(SETTINGS_JSON, before, after))).toBe('overwrite')
	})

	it('falls back to the line test for JSON that does not parse', () => {
		const before = '// comment\n{ "a": 1 }'

		expect(init_dry_run_report.change_kind(change('tsconfig.json', before, `${before}\n`))).toBe(
			'merge',
		)
	})
})

describe('init_dry_run_report.package_json_lines', () => {
	it('lists each changed entry of an object field and each changed top-level field', () => {
		const before = JSON.stringify({ name: 'app', scripts: { dev: 'vite', old: 'x' }, type: 'cjs' })
		const after = JSON.stringify({
			name: 'app',
			scripts: { dev: 'vite dev', test: 'vitest' },
			type: 'module',
			engines: { node: '24' },
		})

		expect(
			init_dry_run_report.package_json_lines(change(PACKAGE_JSON, before, after)),
		).toStrictEqual([
			'~ scripts.dev "vite" → "vite dev"',
			'- scripts.old',
			'+ scripts.test "vitest"',
			'~ type "cjs" → "module"',
			'+ engines.node "24"',
		])
	})

	it('lists a block removed whole entry by entry, and a value replacing a block as one line', () => {
		const before = JSON.stringify({ gone: { a: 1 }, kind: { b: 2 } })
		const after = JSON.stringify({ kind: 'flat' })

		expect(
			init_dry_run_report.package_json_lines(change(PACKAGE_JSON, before, after)),
		).toStrictEqual(['- gone.a', '~ kind {"b":2} → "flat"'])
	})

	it('reads a manifest that does not parse as an empty one', () => {
		const lines = init_dry_run_report.package_json_lines(change(PACKAGE_JSON, '{', '{"a":1}'))

		expect(lines).toStrictEqual(['+ a 1'])
	})
})

describe('init_dry_run_report.format_report', () => {
	it('lays out the title, each file and its kind, the manifest entries and the dependencies', () => {
		const changes = [change(README, undefined, 'x'), change(PACKAGE_JSON, '{}', '{"a":1}')]
		const report = init_dry_run_report.format_report(TITLE, changes, [INSTALL_LINE])

		expect(report.split('\n')).toStrictEqual([
			TITLE,
			'',
			'Files:',
			`  create    ${README}`,
			`  merge     ${PACKAGE_JSON}`,
			'      + a 1',
			'',
			'Dependencies:',
			`  ${INSTALL_LINE}`,
		])
	})

	it('says so when the setup changes no file', () => {
		expect(init_dry_run_report.format_report(TITLE, [], [])).toContain('(no file changes)')
	})
})

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { gate_labels } from './gate-labels'
import { verification_inputs } from './verification-inputs'

// joshuafolkken/kit#4495: each verification's inputs are declared once, and every reuse answers from
// the declaration — the configurations it cannot narrow past, and the fingerprint of its tools and
// environment.

const PACKAGE_JSON = 'package.json'
const SOURCE_FILE = 'scripts/thing.ts'
const NODE_ENV = 'NODE_ENV'
const TEST_ENV = 'test'
const BEHAVIOR_LABEL = 'behavior'
const ESLINT_CONFIG = 'eslint.config.js'
const ESLINT_BASE = 'eslint/base.js'
const WIRED_MODULE = 'eslint/rules/wired.js'
const WIRED_SPECIFIER = './eslint/rules/wired.js'
const PACKAGE_IMPORT = '#rule'
const PACKAGE_EXPORT = './rule'

describe('verification_inputs.configures', () => {
	it.each([
		PACKAGE_JSON,
		'pnpm-lock.yaml',
		'.npmrc',
		'.editorconfig',
		'.gitignore',
		'.prettierignore',
		'.prettierrc.json',
		'packages/app/package.json',
	])('reads %j as a configuration of every declared check', (relative) => {
		for (const label of verification_inputs.DECLARED_LABELS) {
			expect(verification_inputs.configures(label, [relative])).toBe(true)
		}
	})

	it.each([SOURCE_FILE, 'README.md', 'cspell.config.yaml'])('leaves %j out', (relative) => {
		for (const label of verification_inputs.DECLARED_LABELS) {
			expect(verification_inputs.configures(label, [relative])).toBe(false)
		}
	})

	it.each([ESLINT_BASE, ESLINT_CONFIG, 'prettier.config.js', 'tsconfig.json'])(
		'reads %j as a lint configuration',
		(relative) => {
			expect(verification_inputs.configures(gate_labels.LINT_LABEL, [relative])).toBe(true)
		},
	)

	it('reads a vitest configuration as the unit step’s alone', () => {
		const relatives = ['vitest.config.ts']

		expect(verification_inputs.configures(gate_labels.UNIT_LABEL, relatives)).toBe(true)
		expect(verification_inputs.configures(gate_labels.LINT_LABEL, relatives)).toBe(false)
	})

	it('answers true for an undeclared check, which no narrowing reads past', () => {
		expect(verification_inputs.configures(BEHAVIOR_LABEL, [SOURCE_FILE])).toBe(true)
	})
})

// joshuafolkken/kit#5380: a rule module the eslint config does not import yet changes no lint result,
// so a change to it alone must not switch `lint --changed` to the whole tree.
function write_project(config_source = "import './eslint/base.js'\n"): string {
	const root = mkdtempSync(path.join(tmpdir(), 'kit-lint-config-reach-'))

	mkdirSync(path.join(root, 'eslint', 'rules'), { recursive: true })
	writeFileSync(path.join(root, ESLINT_CONFIG), config_source)
	writeFileSync(path.join(root, 'eslint', 'base.js'), "export * from './rules/wired.js'\n")
	writeFileSync(path.join(root, 'eslint', 'rules', 'wired.js'), '')
	writeFileSync(path.join(root, 'eslint', 'rules', PACKAGE_JSON), '{"main":"wired.js"}')
	writeFileSync(path.join(root, 'eslint', 'rules', 'pending.js'), '')

	return root
}

describe('verification_inputs.configures for the eslint config modules', () => {
	it('leaves the tests beside the eslint rules out of the lint configuration', () => {
		const relatives = ['eslint/config-fingerprint.test.ts']

		expect(verification_inputs.configures(gate_labels.LINT_LABEL, relatives)).toBe(false)
	})

	it.each([ESLINT_BASE, WIRED_MODULE])(
		'reads %j, which the config imports, as a lint configuration',
		(relative) => {
			const root = write_project()

			expect(verification_inputs.configures(gate_labels.LINT_LABEL, [relative], root)).toBe(true)
			rmSync(root, { recursive: true, force: true })
		},
	)

	it('leaves a rule module the config does not import yet out', () => {
		const root = write_project()
		const relatives = ['eslint/rules/pending.js']

		expect(verification_inputs.configures(gate_labels.LINT_LABEL, relatives, root)).toBe(false)
		rmSync(root, { recursive: true, force: true })
	})
})

describe('verification_inputs.configures for local import forms', () => {
	it.each([
		'await import(`./eslint/rules/wired.js`)\n',
		"require('./eslint/rules')\n",
		"import '#rule'\n",
		"import 'lint-fixture/rule'\n",
	])('reads the rule loaded through %j as configuration', (entry) => {
		const root = write_project(entry)

		writeFileSync(
			path.join(root, PACKAGE_JSON),
			JSON.stringify({
				name: 'lint-fixture',
				imports: { [PACKAGE_IMPORT]: { import: WIRED_SPECIFIER } },
				exports: { [PACKAGE_EXPORT]: { import: WIRED_SPECIFIER } },
			}),
		)
		expect(verification_inputs.configures(gate_labels.LINT_LABEL, [WIRED_MODULE], root)).toBe(true)
		rmSync(root, { recursive: true, force: true })
	})
})

describe('verification_inputs.declaration_of', () => {
	it('declares the scoped checks and cspell, and leaves behavior undeclared', () => {
		expect(verification_inputs.is_declared(gate_labels.LINT_LABEL)).toBe(true)
		expect(verification_inputs.is_declared(gate_labels.SPELL_CHECK_LABEL)).toBe(true)
		expect(verification_inputs.is_declared(gate_labels.UNIT_LABEL)).toBe(true)
		expect(verification_inputs.is_declared(BEHAVIOR_LABEL)).toBe(false)
	})

	it('declares the run-time read record as the unit step’s inputs alone', () => {
		expect(verification_inputs.declaration_of(gate_labels.UNIT_LABEL)?.reads).toBe('recorded')
		expect(verification_inputs.declaration_of(gate_labels.LINT_LABEL)?.reads).toBe('matched')
	})
})

function install(root: string, tool: string, version: string): void {
	const directory = path.join(root, 'node_modules', tool)

	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, PACKAGE_JSON), JSON.stringify({ version }))
}

describe('verification_inputs.fingerprint', () => {
	let root = ''

	beforeEach(() => {
		root = mkdtempSync(path.join(tmpdir(), 'verification-inputs-'))
		install(root, 'typescript', '5.0.0')
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	function of(label: string, environment: Record<string, string> = {}): string {
		return verification_inputs.fingerprint([label], root, environment)
	}

	it('moves when a declared tool is reinstalled at another version', () => {
		const before = of(gate_labels.TYPE_CHECK_LABEL)

		install(root, 'typescript', '5.1.0')

		expect(of(gate_labels.TYPE_CHECK_LABEL)).not.toBe(before)
	})

	it('moves when a declared environment variable changes', () => {
		const before = of(gate_labels.TYPE_CHECK_LABEL)

		expect(of(gate_labels.TYPE_CHECK_LABEL, { [NODE_ENV]: TEST_ENV })).not.toBe(before)
	})

	it('stays put while only an undeclared environment variable or tool moves', () => {
		const before = of(gate_labels.TYPE_CHECK_LABEL)

		install(root, 'vitest', '3.0.0')

		expect(of(gate_labels.TYPE_CHECK_LABEL, { TZ: 'UTC' })).toBe(before)
		expect(of(gate_labels.UNIT_LABEL, { TZ: 'UTC' })).not.toBe(of(gate_labels.UNIT_LABEL))
	})

	it('answers the whole gate from the union of every declaration', () => {
		const labels = verification_inputs.DECLARED_LABELS
		const before = verification_inputs.fingerprint(labels, root, {})

		install(root, 'vitest', '3.0.0')

		expect(verification_inputs.fingerprint(labels, root, {})).not.toBe(before)
	})
})

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

	it.each(['eslint/rules/thing.ts', 'eslint.config.js', 'prettier.config.js', 'tsconfig.json'])(
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

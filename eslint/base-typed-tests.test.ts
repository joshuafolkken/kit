import { writeFileSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { temporary_directory } from '#tools/test/temporary-directory'
import { ESLint, type Linter } from 'eslint'
import ts from 'typescript-eslint'
import { describe, expect, it, vi } from 'vitest'
import { create_base_config } from './base.js'
import { code_quality_rules } from './rules/code-quality.js'
import { naming_convention_rules } from './rules/naming-convention.js'
import { promise_rules } from './rules/promise.js'
import { typescript_rules } from './rules/typescript.js'

const LINT_PROBE_TIMEOUT_MS = 60_000
const ERROR = 2
const OFF = 0
const CONDITION_RULE = '@typescript-eslint/no-unnecessary-condition'
const RETAINED_RULES = ['no-floating-promises', 'no-misused-promises']
const SOURCE_FILE = 'probe.ts'
const TEST_FILES = ['probe.test.ts', 'probe.e2e.ts']
const SOURCE = [
	'declare function task(): Promise<void>;',
	'declare function accept(callback: () => void): void;',
	'task();',
	'accept(async () => {});',
	'const condition: true = true;',
	'if (condition) { task(); }',
].join('\n')

vi.setConfig({ testTimeout: LINT_PROBE_TIMEOUT_MS })

const make_directory = temporary_directory()

function create_linter(): ESLint {
	const root = make_directory('kit-typed-tests-')
	const config = { compilerOptions: { strict: true, types: [], lib: ['es2022'] } }

	writeFileSync(path.join(root, 'tsconfig.json'), JSON.stringify(config))
	for (const file of [SOURCE_FILE, ...TEST_FILES]) writeFileSync(path.join(root, file), SOURCE)
	const gitignore_path = pathToFileURL(path.join(root, '.gitignore'))

	return new ESLint({
		cwd: root,
		overrideConfigFile: true,
		overrideConfig: create_base_config({
			gitignore_path,
			tsconfig_root_dir: root,
		}),
	})
}

function severity(entry: unknown): unknown {
	return Array.isArray(entry) ? entry[0] : entry
}

function typed_rule_names(): Array<string> {
	return Object.keys(ts.configs.disableTypeChecked.rules ?? {})
}

function production_rules(): Linter.RulesRecord {
	const presets = [...ts.configs.strictTypeChecked, ...ts.configs.stylisticTypeChecked]

	const rules = Object.assign(
		{},
		...presets.map((block) => block.rules),
		naming_convention_rules,
		typescript_rules,
		code_quality_rules,
		promise_rules,
	)

	return Object.fromEntries(
		typed_rule_names()
			.filter((name) => Object.hasOwn(rules, name))
			.map((name) => [name, rules[name]]),
	)
}

async function production_config(): Promise<Linter.Config> {
	const reference = new ESLint({
		overrideConfigFile: true,
		overrideConfig: {
			files: ['**/*.ts'],
			plugins: { '@typescript-eslint': ts.plugin },
			rules: production_rules(),
		},
	})

	return reference.calculateConfigForFile(SOURCE_FILE)
}

async function diagnostics(linter: ESLint, file: string): Promise<Array<string | null>> {
	const [result] = await linter.lintFiles([file])

	expect(result?.fatalErrorCount).toBe(0)

	return result?.messages.map((message) => message.ruleId) ?? []
}

describe('typed test rule subset', () => {
	it.each(TEST_FILES)(
		'keeps only the two async safety rules for %s (ac-5d6e9e31)',
		async (file) => {
			const config: Linter.Config = await create_linter().calculateConfigForFile(file)

			for (const rule of typed_rule_names()) {
				const retained = RETAINED_RULES.some((name) => rule === `@typescript-eslint/${name}`)

				expect(severity(config.rules?.[rule]), rule).toBe(retained ? ERROR : OFF)
			}
		},
	)

	it('preserves every production typed rule and its options (ac-7faccdfa)', async () => {
		const config: Linter.Config = await create_linter().calculateConfigForFile(SOURCE_FILE)
		const expected = await production_config()

		for (const rule of typed_rule_names()) {
			expect(config.rules?.[rule], rule).toEqual(expected.rules?.[rule])
		}
	})

	it.each([SOURCE_FILE, ...TEST_FILES])(
		'removes the unused-modules entry for %s (ac-914f5205)',
		async (file) => {
			const config: Linter.Config = await create_linter().calculateConfigForFile(file)

			expect(config.rules).not.toHaveProperty('import/no-unused-modules')
		},
	)
})

describe('typed test rule diagnostics', () => {
	it.each(TEST_FILES)(
		'reports retained rules but not removed typed checks for %s (ac-2a158383)',
		async (file) => {
			const messages = await diagnostics(create_linter(), file)

			expect(messages).toContain('@typescript-eslint/no-floating-promises')
			expect(messages).toContain('@typescript-eslint/no-misused-promises')
			expect(messages).not.toContain(CONDITION_RULE)
		},
	)

	it('still reports the removed test check on production source', async () => {
		const messages = await diagnostics(create_linter(), SOURCE_FILE)

		expect(messages).toContain(CONDITION_RULE)
	})
})

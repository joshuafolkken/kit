import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { temporary_directory } from '#tools/test/temporary-directory'
import { write_file } from '#tools/test/write-file'
import { ESLint, type Linter } from 'eslint'
import ts from 'typescript-eslint'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { create_base_config } from './base.js'
import { untyped_environment } from './untyped-environment.js'
import { untyped_lint } from './untyped.js'

vi.setConfig({ testTimeout: 60_000 })

const make_directory = temporary_directory('suite')
const root = make_directory('eslint-untyped-')
const PROBE = 'probe.ts'
const GITIGNORE = '.gitignore'

write_file(root, GITIGNORE, '')
write_file(
	root,
	'tsconfig.json',
	JSON.stringify({
		compilerOptions: { strict: true, module: 'esnext', moduleResolution: 'bundler' },
		include: ['**/*.ts'],
	}),
)

// Problems the edit hook fixes with or without a type program: a `let` never reassigned, a
// redundant `else`, a template literal with nothing in it.
const UNFIXED = [
	'export function describe_flag(is_on: boolean): string {',
	'\tlet label = `flag`',
	'\tif (is_on) {',
	"\t\treturn label + ' on'",
	'\t} else {',
	"\t\treturn label + ' off'",
	'\t}',
	'}',
	'',
].join('\n')

// The rules whose fix the edit hook gave up with the type program (joshuafolkken/kit#6768); the gate's
// typed lint still reports each of them.
const TYPED_FIXABLE_RULES: ReadonlyArray<string> = [
	'@typescript-eslint/consistent-type-exports',
	'@typescript-eslint/dot-notation',
	'@typescript-eslint/no-confusing-void-expression',
	'@typescript-eslint/no-duplicate-type-constituents',
	'@typescript-eslint/no-meaningless-void-operator',
	'@typescript-eslint/no-unnecessary-boolean-literal-compare',
	'@typescript-eslint/no-unnecessary-qualifier',
	'@typescript-eslint/no-unnecessary-template-expression',
	'@typescript-eslint/no-unnecessary-type-arguments',
	'@typescript-eslint/no-unnecessary-type-assertion',
	'@typescript-eslint/non-nullable-type-assertion-style',
	'@typescript-eslint/prefer-includes',
	'@typescript-eslint/prefer-optional-chain',
	'@typescript-eslint/prefer-reduce-type-parameter',
	'@typescript-eslint/prefer-regexp-exec',
	'@typescript-eslint/prefer-return-this-type',
	'@typescript-eslint/prefer-string-starts-ends-with',
	'@typescript-eslint/promise-function-async',
	'@typescript-eslint/return-await',
]

afterEach(() => {
	vi.unstubAllEnvs()
})

function create_linter(is_untyped: boolean): ESLint {
	if (is_untyped) vi.stubEnv(untyped_environment.ENVIRONMENT_VARIABLE, '1')
	const base_config = create_base_config({
		gitignore_path: pathToFileURL(path.join(root, GITIGNORE)),
		tsconfig_root_dir: root,
	})

	return new ESLint({
		cwd: root,
		overrideConfigFile: true,
		overrideConfig: base_config,
		fix: true,
	})
}

async function config_for_probe(is_untyped: boolean): Promise<Linter.Config> {
	return (await create_linter(is_untyped).calculateConfigForFile(PROBE)) as Linter.Config
}

async function fixed_output(is_untyped: boolean, text = UNFIXED): Promise<string | undefined> {
	const [result] = await create_linter(is_untyped).lintText(text, { filePath: PROBE })

	return result?.output
}

// A disable comment for a typed rule the untyped run switches off: `--fix` must leave it in place,
// since the gate's typed lint still needs it.
const TYPED_RULE_DISABLE = [
	'export function is_set(value: string | undefined): boolean {',
	'\tconst text = value ?? `${value}`',
	'\t// eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- probe',
	'\treturn text !== undefined',
	'}',
	'',
].join('\n')

function severity_of(config: Linter.Config, rule: string): unknown {
	const setting = config.rules?.[rule]

	return Array.isArray(setting) ? setting[0] : setting
}

interface RuleShape {
	meta: { docs?: { requiresTypeChecking?: boolean }; fixable?: string }
}

function typed_fixable_rules(config: Linter.Config): ReadonlyArray<string> {
	const prefix = '@typescript-eslint/'
	const rules = (ts.plugin as { rules?: Record<string, RuleShape> }).rules ?? {}

	return Object.entries(rules)
		.filter(([, rule]) => rule.meta.docs?.requiresTypeChecking === true && rule.meta.fixable)
		.map(([name]) => `${prefix}${name}`)
		.filter((name) => {
			const setting = config.rules?.[name]
			const severity = Array.isArray(setting) ? setting[0] : setting

			return severity !== undefined && !['off', 0].includes(severity)
		})
		.toSorted((left, right) => left.localeCompare(right))
}

describe('create_base_config — the untyped switch', () => {
	it('builds no type program when the switch is set', async () => {
		const config = await config_for_probe(true)

		expect(config.languageOptions?.['parserOptions']).toMatchObject({
			project: false,
			projectService: false,
		})
	})

	it('keeps the type program without the switch, as the gate runs it', async () => {
		const config = await config_for_probe(false)

		expect(config.languageOptions?.['parserOptions']).toMatchObject({ projectService: true })
	})

	// `types` selectors throw without a program; dropped, an exported constant still lints.
	it('lints an exported constant without a fatal error', async () => {
		const [result] = await create_linter(true).lintText('export const IS_READY = true\n', {
			filePath: PROBE,
		})

		expect(result?.messages.filter((message) => message.fatal === true)).toEqual([])
		expect(result?.errorCount).toBe(0)
	})

	it('fixes the same output as the typed config', async () => {
		const untyped = await fixed_output(true)

		expect(untyped).not.toBe(UNFIXED)
		expect(untyped).toBe(await fixed_output(false))
	})
})

describe('create_base_config — the typed rules the untyped switch drops', () => {
	it('keeps a disable comment for a typed rule it switches off', async () => {
		const output = (await fixed_output(true, TYPED_RULE_DISABLE)) ?? TYPED_RULE_DISABLE

		expect(output).toContain('eslint-disable-next-line @typescript-eslint/no-unnecessary-condition')
	})

	it('switches off every rule that guesses without a type program', async () => {
		const config = await config_for_probe(true)

		for (const rule of untyped_lint.TYPE_GUESSING_RULES) {
			expect([rule, severity_of(config, rule)]).toEqual([rule, 0])
		}
	})

	it('names the typed rules whose fix the edit hook no longer applies', async () => {
		expect(typed_fixable_rules(await config_for_probe(false))).toEqual(TYPED_FIXABLE_RULES)
	})
})

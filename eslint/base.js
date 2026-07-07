import { fileURLToPath } from 'node:url'
import { includeIgnoreFile } from '@eslint/compat'
import js from '@eslint/js'
import stylistic from '@stylistic/eslint-plugin'
import prettier from 'eslint-config-prettier'
import importPlugin from 'eslint-plugin-import-x'
import promise from 'eslint-plugin-promise'
import sonarjs from 'eslint-plugin-sonarjs'
import unicorn from 'eslint-plugin-unicorn'
import { defineConfig } from 'eslint/config'
import globals from 'globals'
import ts from 'typescript-eslint'
import { code_quality_rules } from './rules/code-quality.js'
import { formatting_rules } from './rules/formatting.js'
import { import_rules } from './rules/import.js'
import { naming_convention_rules } from './rules/naming-convention.js'
import { promise_rules } from './rules/promise.js'
import { sonarjs_rules } from './rules/sonarjs.js'
import { typescript_rules } from './rules/typescript.js'
import { unicorn_rules } from './rules/unicorn.js'

const SCRIPTS_AI_PATTERNS = ['scripts-ai/**/*.ts', 'scripts-ai/**/*.js']

const FILE_PATTERNS = {
	d_ts: ['**/*.d.ts'],
	typescript: ['**/*.ts', '**/*.tsx'],
	scripts_ai: SCRIPTS_AI_PATTERNS,
	scripts: ['scripts/**/*.ts', 'scripts/**/*.js', ...SCRIPTS_AI_PATTERNS],
	tests: ['**/*.test.ts', '**/*.spec.ts', '**/*.e2e.ts'],
	eslint_rules: ['eslint/**/*.ts', 'eslint/rules/**/*.js'],
}

export function create_base_config({ gitignore_path, tsconfig_root_dir }) {
	return defineConfig(
		includeIgnoreFile(fileURLToPath(gitignore_path)),
		{
			ignores: ['node_modules/**', '*.config.{ts,js,cjs,mjs}'],
		},
		js.configs.recommended,
		...ts.configs.strictTypeChecked,
		...ts.configs.stylisticTypeChecked,
		prettier,
		unicorn.configs.recommended,
		sonarjs.configs.recommended,
		{ plugins: { promise }, rules: { ...promise.configs.recommended.rules } },
		importPlugin.flatConfigs.recommended,
		{
			plugins: { import: importPlugin },
			settings: {
				'import/resolver': { typescript: { alwaysTryTypes: true }, node: true },
				'import-x/ignore': ['node_modules'],
			},
		},
		{
			plugins: { '@stylistic': stylistic },
			languageOptions: { globals: { ...globals.browser, ...globals.node } },
			rules: {
				'no-undef': 'off',
				...naming_convention_rules,
				...typescript_rules,
				...code_quality_rules,
				...import_rules,
				...unicorn_rules,
				...sonarjs_rules,
				...promise_rules,
				...formatting_rules,
			},
		},
		{ files: FILE_PATTERNS.d_ts, rules: { 'import/no-default-export': 'off' } },
		{
			files: FILE_PATTERNS.typescript,
			ignores: ['**/*.svelte.ts'],
			languageOptions: {
				parser: ts.parser,
				parserOptions: {
					project: './tsconfig.json',
					tsconfigRootDir: tsconfig_root_dir,
				},
			},
		},
		{
			files: FILE_PATTERNS.scripts,
			rules: {
				'unicorn/no-process-exit': 'off',
				// scripts under scripts/ and scripts-ai/ are dual-purpose: shebang-executable
				// (run via tsx) AND importable namespace modules (consumed via #scripts/* and
				// in tests). unicorn/no-exports-in-scripts flags exports in any shebang file,
				// which conflicts with the kit export { module } convention, so disable it here.
				'unicorn/no-exports-in-scripts': 'off',
				'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
				// CLI tooling under scripts/ invokes pnpm/git/node via PATH by design
				'sonarjs/no-os-command-from-path': 'off',
				// kit's export { module } namespace pattern means functions never use this,
				// so referencing them unbound (e.g. test spies) is safe
				'@typescript-eslint/unbound-method': 'off',
			},
		},
		{
			files: FILE_PATTERNS.scripts_ai,
			rules: {
				'@typescript-eslint/no-restricted-imports': 'off',
			},
		},
		{
			files: FILE_PATTERNS.tests,
			rules: {
				'@typescript-eslint/no-magic-numbers': 'off',
				'max-lines-per-function': ['error', { max: 35, skipBlankLines: true, skipComments: true }],
				'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
				// vi mock/stub patterns require explicit undefined (mockResolvedValue/stubGlobal)
				'unicorn/no-useless-undefined': 'off',
			},
		},
		{
			files: FILE_PATTERNS.eslint_rules,
			rules: {
				'@typescript-eslint/naming-convention': 'off',
				'@typescript-eslint/no-magic-numbers': 'off',
			},
		},
		{
			files: ['**/*.js'],
			...ts.configs.disableTypeChecked,
			rules: {
				...ts.configs.disableTypeChecked.rules,
				// These two rules check for the *presence* of a TS type annotation, so they
				// are not part of disableTypeChecked. A hand-authored .js file cannot express
				// the annotation (JSDoc does not satisfy them), making them unsatisfiable there.
				'@typescript-eslint/explicit-function-return-type': 'off',
				'@typescript-eslint/explicit-module-boundary-types': 'off',
			},
		},
	)
}

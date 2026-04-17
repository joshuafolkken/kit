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
import { code_quality_rules } from './rules/code-quality.ts'
import { formatting_rules } from './rules/formatting.ts'
import { import_rules } from './rules/import.ts'
import { naming_convention_rules } from './rules/naming-convention.ts'
import { promise_rules } from './rules/promise.ts'
import { sonarjs_rules } from './rules/sonarjs.ts'
import { typescript_rules } from './rules/typescript.ts'
import { unicorn_rules } from './rules/unicorn.ts'

const FILE_PATTERNS = {
	d_ts: ['**/*.d.ts'],
	typescript: ['**/*.ts', '**/*.tsx'],
	scripts_ai: ['scripts-ai/**/*.ts', 'scripts-ai/**/*.js'],
	get scripts() {
		return ['scripts/**/*.ts', 'scripts/**/*.js', ...this.scripts_ai]
	},
	tests: ['**/*.test.ts', '**/*.spec.ts'],
	eslint_rules: ['eslint/**/*.ts'],
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
				'no-console': ['error', { allow: ['warn', 'error', 'info'] }],
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
		},
	)
}

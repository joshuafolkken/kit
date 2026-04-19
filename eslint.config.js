import { fileURLToPath } from 'node:url'
import { create_base_config } from './eslint/base.js'

const ESLINT_API_FILES = ['eslint/*.js']
const ESLINT_TEST_FILES = ['eslint/*.test.ts', 'eslint/*.spec.ts']
const TEMPLATE_FILES = ['templates/**/*.ts']

export default [
	{ ignores: ['templates/**', 'prettier/**'] },
	...create_base_config({
		gitignore_path: new URL('./.gitignore', import.meta.url),
		tsconfig_root_dir: fileURLToPath(new URL('.', import.meta.url)),
	}),
	{
		files: ESLINT_API_FILES,
		rules: {
			'@typescript-eslint/explicit-function-return-type': 'off',
			'@typescript-eslint/explicit-module-boundary-types': 'off',
			'no-restricted-syntax': 'off',
			'max-lines-per-function': 'off',
			'import/extensions': 'off',
		},
	},
	{
		files: ESLINT_TEST_FILES,
		rules: {
			'import/extensions': 'off',
			'@typescript-eslint/no-unsafe-assignment': 'off',
			'@typescript-eslint/no-unsafe-call': 'off',
			'@typescript-eslint/no-unsafe-member-access': 'off',
			'@typescript-eslint/no-unsafe-return': 'off',
		},
	},
	{
		files: TEMPLATE_FILES,
		rules: {
			'no-restricted-syntax': 'off',
			'@typescript-eslint/explicit-function-return-type': 'off',
			'@typescript-eslint/explicit-module-boundary-types': 'off',
		},
	},
]

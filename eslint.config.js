import { fileURLToPath } from 'node:url'
import { create_base_config } from './eslint/base.js'

// Hand-written distributed JS modules: no TS annotations available, so the TS-only style rules
// that assume a `.ts` source are relaxed exactly as they are for the eslint presets.
const DISTRIBUTED_JS_FILES = ['env/*.js', 'eslint/*.js', 'ports/*.js']
const ESLINT_TEST_FILES = ['eslint/*.test.ts', 'eslint/*.spec.ts']
const TEMPLATE_FILES = ['templates/**/*.ts']

export default [
	{ ignores: ['templates/**', 'prettier/**'] },
	...create_base_config({
		gitignore_path: new URL('./.gitignore', import.meta.url),
		tsconfig_root_dir: fileURLToPath(new URL('.', import.meta.url)),
	}),
	{
		files: DISTRIBUTED_JS_FILES,
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

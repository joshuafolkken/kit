import { fileURLToPath } from 'node:url'
import { create_base_config } from './eslint/base.js'
import {
	CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
	centralized_tests_directory_rules,
	SPEC_FILENAME_PATTERNS,
	spec_filename_rules,
} from './eslint/rules/test-filename.js'

// Hand-written distributed JS modules: no TS annotations available, so the TS-only style rules
// that assume a `.ts` source are relaxed exactly as they are for the eslint presets.
const DISTRIBUTED_JS_FILES = ['env/*.js', 'eslint/*.js', 'ports/*.js']
const ESLINT_TEST_FILES = ['eslint/*.test.ts']
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
	// joshuafolkken/kit#1233: `create_base_config` above wires the test-filename bans in, and the two
	// blocks before this one switch `no-restricted-syntax` off wholesale — for the export-convention
	// selectors a hand-written `.js` module cannot satisfy — which takes the bans with it. Flat config
	// resolves later blocks last, so re-stating them here is what keeps `eslint/foo.spec.js` an error
	// in the repository that distributes the rule. The globs and messages come from the same module
	// the base config imports, so there is one source for both.
	{ files: SPEC_FILENAME_PATTERNS, rules: spec_filename_rules },
	{ files: CENTRALIZED_TESTS_DIRECTORY_PATTERNS, rules: centralized_tests_directory_rules },
]

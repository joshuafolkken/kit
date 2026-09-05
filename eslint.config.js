import { fileURLToPath } from 'node:url'
import { create_base_config } from './eslint/base.js'
import { code_quality_rules } from './eslint/rules/code-quality.js'
import {
	CENTRALIZED_TESTS_DIRECTORY_ENTRY,
	CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
	extend_restricted_syntax,
	SPEC_FILENAME_ENTRY,
	SPEC_FILENAME_PATTERNS,
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
	//
	// joshuafolkken/kit#1414: these re-statements are not scoped to the two blocks above — they match
	// every banned file in the repository — so they have to compose `no-restricted-syntax` exactly as
	// the base config does. Set to the ban alone, they would replace the base config's composed entry
	// and take `code-quality.js`'s selectors away from every `*.spec.*` and `tests/` file in kit.
	//
	// The composition has one deliberate side effect: a banned file under `DISTRIBUTED_JS_FILES` —
	// `eslint/foo.spec.js`, say — now reports the export-convention selectors that block relaxes, on
	// top of the ban. Such a file is a lint error either way and its only correct fix is the rename,
	// so the extra report costs nothing; every `.js` module that is not itself banned keeps the
	// relaxation untouched.
	{
		files: SPEC_FILENAME_PATTERNS,
		rules: extend_restricted_syntax(code_quality_rules, SPEC_FILENAME_ENTRY),
	},
	{
		files: CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
		rules: extend_restricted_syntax(code_quality_rules, CENTRALIZED_TESTS_DIRECTORY_ENTRY),
	},
]

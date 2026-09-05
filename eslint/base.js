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
import { config_fingerprint } from './config-fingerprint.js'
import { code_quality_rules } from './rules/code-quality.js'
import { formatting_rules } from './rules/formatting.js'
import { import_rules } from './rules/import.js'
import { naming_convention_rules } from './rules/naming-convention.js'
import { promise_rules } from './rules/promise.js'
import { sonarjs_rules } from './rules/sonarjs.js'
import {
	CENTRALIZED_TESTS_DIRECTORY_ENTRY,
	CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
	extend_restricted_syntax,
	SPEC_FILENAME_ENTRY,
	SPEC_FILENAME_PATTERNS,
} from './rules/test-filename.js'
import { typescript_rules } from './rules/typescript.js'
import { unicorn_rules } from './rules/unicorn.js'

const SCRIPTS_AI_PATTERNS = ['scripts-ai/**/*.ts', 'scripts-ai/**/*.js']

const FILE_PATTERNS = {
	d_ts: ['**/*.d.ts'],
	typescript: ['**/*.ts', '**/*.tsx'],
	scripts_ai: SCRIPTS_AI_PATTERNS,
	scripts: ['scripts/**/*.ts', 'scripts/**/*.js', ...SCRIPTS_AI_PATTERNS],
	// joshuafolkken/kit#1414: `**/*.spec.ts` is deliberately absent. The same config bans that name
	// outright, so handing it the test relaxation (`max-lines-per-function` 35 and the rest) is the
	// config contradicting itself, and it is what makes `*.spec.ts` read as supported. A banned file
	// is already a lint error, so what the removal costs a migrating consumer is one extra error on a
	// file that was failing anyway.
	tests: ['**/*.test.ts', '**/*.e2e.ts'],
	eslint_rules: ['eslint/**/*.ts', 'eslint/rules/**/*.js'],
}

// One test-filename ban block. Both bans differ only in their glob and their message, so the shape
// is written once — the `disableTypeChecked` carry and the rule composition both have to hold
// identically for either, and a second copy is what lets them drift apart.
//
// `disableTypeChecked` is carried because a banned file is usually outside the tsconfig project:
// `tsconfig.json`'s `include` is an allowlist of the directories a project keeps sources in, and a
// top-level `tests/` is by definition not one of them. With the typed parser forced on, such a file
// reports `Parsing error: ... was not found in any of the provided project(s)` and
// `no-restricted-syntax` never runs at all — lint still fails, but on a tsconfig complaint instead
// of the rename-or-move instruction this rule exists to give. Type-aware rules buy nothing on a file
// whose only correct fix is to stop existing under that name.
//
// joshuafolkken/kit#1414 widened the bans to `.tsx` / `.mts` / `.cts` and the JS siblings, and no
// parser has to be named for them: typescript-eslint's own base block installs its parser with no
// `files` restriction, so every extension here is read by it and picks its script kind from the file
// name. `eslint/base.test.ts` asserts each one reports the rule's message rather than a parse error,
// so a future change that narrows that parser fails there instead of silently.
//
// joshuafolkken/kit#1414: `no-restricted-syntax` is composed on top of `code_quality_rules` rather
// than set on its own, because flat config replaces a rule's options instead of merging them — set
// alone, the ban would silently drop that module's four selectors on exactly the files it applies
// to, which a consumer keeping a legitimate `tests/` would inherit as a hole.
function create_test_filename_ban_block(files, ban_entry) {
	return {
		files,
		...ts.configs.disableTypeChecked,
		rules: {
			...ts.configs.disableTypeChecked.rules,
			...extend_restricted_syntax(code_quality_rules, ban_entry),
		},
	}
}

export function create_base_config({ gitignore_path, tsconfig_root_dir }) {
	return defineConfig(
		includeIgnoreFile(fileURLToPath(gitignore_path)),
		{
			// joshuafolkken/kit#1112: `.claude/worktrees/` is where Claude Code puts its bridge work
			// trees — a full checkout of the project, carrying its own repository root. Linted, every
			// one of its TypeScript files fails to parse: typescript-eslint finds two candidate
			// `tsconfigRootDir`s, the project's and the work tree's, and refuses to choose. The work
			// trees are created and removed on their own, so the same commit lints green or red
			// depending on whether one happens to exist, which reads as an unstable linter rather
			// than as a scope problem.
			//
			// It is listed here rather than left to `includeIgnoreFile` above, because git excludes
			// these through `.git/info/exclude` — a per-checkout file that is never committed and
			// that nothing outside git reads. The same gap published them to npm until
			// joshuafolkken/kit#1107 narrowed `files`; this is that gap's other half, and the fix has
			// to live in the shared config so every consumer inherits it.
			// `**/` anchors nowhere: a monorepo puts a package's work trees at
			// `packages/<name>/.claude/worktrees/`, and a root-anchored pattern lints every one of
			// them. It is the spelling git's own exclude uses, for the same reason.
			ignores: ['node_modules/**', '**/.claude/worktrees/**', '*.config.{ts,js,cjs,mjs}'],
		},
		// joshuafolkken/kit#1347: a content fingerprint of this directory's rule modules, carried in
		// `settings` so that ESLint's own cache key changes when one of them is edited. Serializing the
		// config drops every `create` function, so without this an edit to a rule left every cached
		// entry valid and the gate reported the pre-edit verdict for every unchanged file. It sits in
		// the shared config rather than beside either cache file because both the gate's cache and the
		// edit hook's are invalidated by the same value — `config-fingerprint.js` carries the reasoning
		// and what the fingerprint deliberately does not cover.
		config_fingerprint.create_config_fingerprint_block(),
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
				// describe-scoped `let` assigned in beforeEach is the standard vitest fixture shape;
				// the declaration cannot be initialized where it is declared.
				'init-declarations': 'off',
				// `expect(x).toBe(0.05)` compares deterministic config constants, not computed
				// floats; working around the rule only weakens the assertion.
				'sonarjs/no-floating-point-equality': 'off',
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
		// joshuafolkken/kit#1233: the test-filename bans are wired into the shared base config
		// rather than left to each consumer's own `eslint.config.js`. Exported alone
		// (`@joshuafolkken/kit/eslint/test-filename`), the rule reached only the projects that
		// remembered to wire it — kit itself never did, so the `*.spec.ts` and top-level `tests/`
		// bans the documents call lint-enforced were a reader's check in the very repository that
		// distributes them. Every consumer of `create_base_config` now inherits both.
		//
		// These two blocks come last so nothing inside this config can override them; a project's
		// own trailing blocks still can, which is how `eslint.config.js` keeps its existing
		// per-directory relaxations.
		create_test_filename_ban_block(SPEC_FILENAME_PATTERNS, SPEC_FILENAME_ENTRY),
		create_test_filename_ban_block(
			CENTRALIZED_TESTS_DIRECTORY_PATTERNS,
			CENTRALIZED_TESTS_DIRECTORY_ENTRY,
		),
	)
}

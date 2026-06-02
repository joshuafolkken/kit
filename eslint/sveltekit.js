import svelte from 'eslint-plugin-svelte'
import { defineConfig } from 'eslint/config'
import ts from 'typescript-eslint'
import { create_base_config } from './base.js'
import { ROUTE_NO_RESTRICTED_SYNTAX, svelte_rules } from './rules/svelte.js'

const SVELTE_COMPONENT_PATTERN = '**/*.svelte'
const SVELTE_TS_PATTERN = '**/*.svelte.ts'

const SVELTE_FILE_PATTERNS = {
	// Real Svelte source modules — get the Svelte parser config.
	// Test files are excluded: they are plain TS and would otherwise hit
	// `Parsing error: Enabling "project" does nothing when "projectService" is enabled`.
	svelte_source: [SVELTE_COMPONENT_PATTERN, SVELTE_TS_PATTERN],
	// All Svelte-paired files including tests — get the filename / rule conventions
	// (PascalCase filename, allowList for props, etc.).
	svelte_named: [
		SVELTE_COMPONENT_PATTERN,
		SVELTE_TS_PATTERN,
		'**/*.svelte.test.ts',
		'**/*.svelte.spec.ts',
	],
	svelte_js: ['**/*.svelte.js'],
	hooks: ['**/hooks/**/*.svelte.ts', '**/*State.svelte.ts'],
	routes: ['src/routes/**/+*.ts', 'src/routes/**/+*.js'],
	params: ['src/params/**/*.ts'],
	phrases: ['**/phrases/collections/*.ts', '**/phrases/praise.ts'],
}

const HOOK_MAX_LINES = 150
const HOOK_MAX_STATEMENTS = 15

const SVELTEKIT_ROUTE_PATTERNS = [
	String.raw`\+page\.svelte$`,
	String.raw`\+layout\.svelte$`,
	String.raw`\+error\.svelte$`,
	String.raw`\+server\.ts$`,
]

export function create_sveltekit_config({ gitignore_path, tsconfig_root_dir, svelte_config }) {
	return defineConfig(
		...create_base_config({ gitignore_path, tsconfig_root_dir }),
		// SvelteKit's ambient declarations file uses external-contract binding names
		// (RATE_LIMITER, APP_VERSION) and the `export {}` module marker, which never
		// follow the kit's strict naming/export rules. Linting it only yields false
		// positives, so ignore it by default. See issue #474.
		{ ignores: ['src/app.d.ts'] },
		...svelte.configs.recommended,
		...svelte.configs.prettier,
		{
			files: SVELTE_FILE_PATTERNS.svelte_source,
			languageOptions: {
				parserOptions: {
					projectService: true,
					extraFileExtensions: ['.svelte'],
					parser: ts.parser,
					svelteConfig: svelte_config,
				},
			},
		},
		{
			files: SVELTE_FILE_PATTERNS.svelte_named,
			// Note: unicorn/prevent-abbreviations is configured project-wide (including .svelte)
			// in eslint/rules/unicorn.js, so this override intentionally does not re-specify it.
			rules: {
				'unicorn/filename-case': [
					'error',
					{ case: 'pascalCase', ignore: SVELTEKIT_ROUTE_PATTERNS },
				],
				'sonarjs/no-unused-collection': 'off',
				// {@render snippet()} is a Svelte template directive, not a value-consuming
				// expression; the rule misreads the void snippet call as a useless return value.
				'sonarjs/no-use-of-empty-return-value': 'off',
				...svelte_rules,
			},
		},
		{
			files: SVELTE_FILE_PATTERNS.hooks,
			rules: {
				'prefer-const': 'off',
				'max-lines-per-function': ['error', HOOK_MAX_LINES],
				'max-statements': ['error', HOOK_MAX_STATEMENTS],
			},
		},
		{
			files: SVELTE_FILE_PATTERNS.routes,
			rules: { 'no-restricted-syntax': ROUTE_NO_RESTRICTED_SYNTAX },
		},
		{
			files: SVELTE_FILE_PATTERNS.params,
			rules: { 'unicorn/filename-case': 'off', 'no-restricted-syntax': 'off' },
		},
		{
			files: SVELTE_FILE_PATTERNS.phrases,
			rules: { 'max-lines': 'off', 'sonarjs/no-duplicate-string': 'off' },
		},
	)
}

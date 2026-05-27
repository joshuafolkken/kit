import svelte from 'eslint-plugin-svelte'
import { defineConfig } from 'eslint/config'
import ts from 'typescript-eslint'
import { create_base_config } from './base.js'
import { ROUTE_NO_RESTRICTED_SYNTAX, svelte_rules } from './rules/svelte.js'

const SVELTE_FILE_PATTERNS = {
	svelte: ['**/*.svelte', '**/*.svelte.ts', '**/*.svelte.test.ts', '**/*.svelte.spec.ts'],
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

// 普遍的に理解されている短縮名は許可する
// (rule の目的は `req`/`res`/`usr`/`cnt` 等の慣れない略語を弾くこと)
const PREVENT_ABBR_ALLOW_LIST = {
	Props: true,
	e: true, // event handler parameter
	el: true, // DOM element
	ctx: true, // canvas/Three.js/Svelte context
	btn: true, // button element
	idx: true, // loop index
	opts: true, // options object
	params: true, // SvelteKit +page.ts params
	args: true, // function arguments
}

export function create_sveltekit_config({ gitignore_path, tsconfig_root_dir, svelte_config }) {
	return defineConfig(
		...create_base_config({ gitignore_path, tsconfig_root_dir }),
		...svelte.configs.recommended,
		...svelte.configs.prettier,
		{
			files: SVELTE_FILE_PATTERNS.svelte,
			languageOptions: {
				parserOptions: {
					projectService: true,
					extraFileExtensions: ['.svelte'],
					parser: ts.parser,
					svelteConfig: svelte_config,
				},
			},
			rules: {
				'unicorn/filename-case': [
					'error',
					{ case: 'pascalCase', ignore: SVELTEKIT_ROUTE_PATTERNS },
				],
				'unicorn/prevent-abbreviations': ['error', { allowList: PREVENT_ABBR_ALLOW_LIST }],
				'sonarjs/no-unused-collection': 'off',
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

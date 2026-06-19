import { readFileSync } from 'node:fs'
import type { ProjectType } from './init-logic'
import { package_path } from './init-paths'

// Tokens replaced (or removed) depending on whether the project still ships a
// svelte.config file. The new `sv` library template drops it, so importing it
// unconditionally throws ERR_MODULE_NOT_FOUND — see Fix B / make_sveltekit_template.
const SVELTE_IMPORT_TOKEN = '$SVELTE_IMPORT'
const SVELTE_FIELD_TOKEN = '$SVELTE_FIELD'
const SVELTE_CONFIG_IMPORT = "import svelteConfig from './svelte.config.js'"

// Template strings below contain `export default` as generated file content, not as module exports.
// The import token sits flush before `export default` so the blank-line separator lives in the
// replacement; the field token sits flush after the trailing comma so the leading newline does too.
const ESLINT_SVELTEKIT_TPL = `import { create_sveltekit_config } from '@joshuafolkken/kit/eslint/sveltekit'
${SVELTE_IMPORT_TOKEN}export default create_sveltekit_config({
\tgitignore_path: new URL('./.gitignore', import.meta.url),
\ttsconfig_root_dir: import.meta.dirname,${SVELTE_FIELD_TOKEN}
})
`

const ESLINT_VANILLA = `import { create_vanilla_config } from '@joshuafolkken/kit/eslint/vanilla'

export default create_vanilla_config({
\tgitignore_path: new URL('./.gitignore', import.meta.url),
\ttsconfig_root_dir: import.meta.dirname,
})
`

const DEFAULT_TAILWIND_STYLESHEET = './src/routes/layout.css'
const TAILWIND_STYLESHEET_PATTERN = /tailwindStylesheet"?:\s*['"]([^'"]+)['"]/u

const KIT_ESLINT_IMPORT_MARKER = '@joshuafolkken/kit/eslint/'
const VANILLA_ESLINT_MARKERS: ReadonlyArray<string> = [
	'js.configs.recommended',
	'ts.configs.recommended',
	'svelte.configs.recommended',
]
const RULES_BLOCK_PATTERN = /rules\s*:\s*\{/gu
const RULES_INDENT_DEPTH = 3
const RULES_INDENT = '\t'.repeat(RULES_INDENT_DEPTH)

const PLAYWRIGHT_TEMPLATE_PATH = package_path('playwright.config.ts')

const VITE_CONFIG_SVELTEKIT = `import type { UserConfig, ConfigEnv } from 'vite'
import { visualizer } from 'rollup-plugin-visualizer'
import { sveltekit } from '@sveltejs/kit/vite'
import { defineConfig } from 'vite'

export default defineConfig({
\tplugins: [
\t\tsveltekit(),
\t\t{
\t\t\t...visualizer({ open: !process.env['CI'], filename: 'stats-client.html' }),
\t\t\tapply: (config: UserConfig, { command }: ConfigEnv) =>
\t\t\t\tcommand === 'build' && !config.build?.ssr,
\t\t},
\t\t{
\t\t\t...visualizer({ open: !process.env['CI'], filename: 'stats-server.html' }),
\t\t\tapply: (config: UserConfig, { command }: ConfigEnv) =>
\t\t\t\tcommand === 'build' && !!config.build?.ssr,
\t\t},
\t],
})
`

const SVELTEKIT_WITH_RULES_TPL = `import { create_sveltekit_config } from '@joshuafolkken/kit/eslint/sveltekit'
${SVELTE_IMPORT_TOKEN}export default [
\t...create_sveltekit_config({
\t\tgitignore_path: new URL('./.gitignore', import.meta.url),
\t\ttsconfig_root_dir: import.meta.dirname,${SVELTE_FIELD_TOKEN}
\t}),
\t{
\t\trules: {
$RULES
\t\t},
\t},
]
`

const VANILLA_WITH_RULES_TPL = `import { create_vanilla_config } from '@joshuafolkken/kit/eslint/vanilla'

export default [
\t...create_vanilla_config({
\t\tgitignore_path: new URL('./.gitignore', import.meta.url),
\t\ttsconfig_root_dir: import.meta.dirname,
\t}),
\t{
\t\trules: {
$RULES
\t\t},
\t},
]
`

const RULES_PLACEHOLDER = '$RULES'
const NOT_FOUND = -1

// The `svelte_config` field is indented one level in the bare template and two levels inside
// the rules-array spread, so each template fills the token at its own depth.
const SVELTE_FIELD_INDENT_PLAIN = '\t'
const SVELTE_FIELD_INDENT_RULES = '\t\t'

// Replace the svelte.config tokens: emit the import line + field when the project still ships a
// svelte.config file, otherwise strip both. Vanilla templates carry no tokens, so this no-ops them.
function fill_svelte_tokens(
	template: string,
	has_svelte_config: boolean,
	field_indent: string,
): string {
	const import_replacement = has_svelte_config ? `${SVELTE_CONFIG_IMPORT}\n\n` : '\n'
	const field_replacement = has_svelte_config ? `\n${field_indent}svelte_config: svelteConfig,` : ''

	return template
		.replace(SVELTE_IMPORT_TOKEN, () => import_replacement)
		.replace(SVELTE_FIELD_TOKEN, () => field_replacement)
}

function generate_eslint_config(type: ProjectType, has_svelte_config: boolean): string {
	if (type !== 'sveltekit') return ESLINT_VANILLA

	return fill_svelte_tokens(ESLINT_SVELTEKIT_TPL, has_svelte_config, SVELTE_FIELD_INDENT_PLAIN)
}

function is_vanilla_eslint_config(existing: string): boolean {
	if (existing.includes(KIT_ESLINT_IMPORT_MARKER)) return false

	return VANILLA_ESLINT_MARKERS.some((marker) => existing.includes(marker))
}

function update_brace_depth(char: string | undefined, depth: number): number {
	if (char === '{') return depth + 1
	if (char === '}') return depth - 1

	return depth
}

function find_matching_close_brace(source: string, open_index: number): number {
	let depth = 0

	for (let index = open_index; index < source.length; index += 1) {
		depth = update_brace_depth(source[index], depth)
		if (depth === 0 && source[index] === '}') return index
	}

	return NOT_FOUND
}

function extract_block_from_open(source: string, open_index: number): string | undefined {
	const close = find_matching_close_brace(source, open_index)
	if (close === NOT_FOUND) return undefined
	const inner = source.slice(open_index + 1, close).trim()

	return inner.length > 0 ? inner : undefined
}

function extract_rules_inner_blocks(existing: string): ReadonlyArray<string> {
	const blocks: Array<string> = []

	for (const match of existing.matchAll(RULES_BLOCK_PATTERN)) {
		const open = match.index + match[0].length - 1
		const inner = extract_block_from_open(existing, open)
		if (inner !== undefined) blocks.push(inner)
	}

	return blocks
}

function indent_block(text: string, indent: string): string {
	return text
		.split('\n')
		.map((line) => (line.length === 0 ? line : `${indent}${line.trimStart()}`))
		.join('\n')
}

function apply_rules_template(
	type: ProjectType,
	rules_body: string,
	has_svelte_config: boolean,
): string {
	const template = type === 'sveltekit' ? SVELTEKIT_WITH_RULES_TPL : VANILLA_WITH_RULES_TPL
	const filled = fill_svelte_tokens(template, has_svelte_config, SVELTE_FIELD_INDENT_RULES)
	const rules_block = indent_block(rules_body, RULES_INDENT)

	return filled.replace(RULES_PLACEHOLDER, () => rules_block)
}

function merge_eslint_config(
	existing: string,
	type: ProjectType,
	has_svelte_config: boolean,
): string {
	if (!is_vanilla_eslint_config(existing)) return existing
	const rules_blocks = extract_rules_inner_blocks(existing)
	if (rules_blocks.length === 0) return generate_eslint_config(type, has_svelte_config)

	return apply_rules_template(type, rules_blocks.join(',\n'), has_svelte_config)
}

function generate_prettier_config(stylesheet: string = DEFAULT_TAILWIND_STYLESHEET): string {
	return `import { config } from '@joshuafolkken/kit/prettier'

export default {
\t...config,
\ttailwindStylesheet: '${stylesheet}',
}
`
}

function merge_prettier_config(existing: string): string {
	const match = TAILWIND_STYLESHEET_PATTERN.exec(existing)

	return generate_prettier_config(match?.[1] ?? DEFAULT_TAILWIND_STYLESHEET)
}

function generate_playwright_config(): string {
	return readFileSync(PLAYWRIGHT_TEMPLATE_PATH, 'utf8')
}

function generate_vite_config(): string {
	return VITE_CONFIG_SVELTEKIT
}

const init_logic_templates = {
	generate_eslint_config,
	merge_eslint_config,
	generate_prettier_config,
	merge_prettier_config,
	generate_playwright_config,
	generate_vite_config,
}

export { init_logic_templates }

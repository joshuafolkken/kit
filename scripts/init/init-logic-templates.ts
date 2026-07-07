import { readFileSync } from 'node:fs'
import { package_path } from './init-paths'

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

function generate_eslint_config(): string {
	return ESLINT_VANILLA
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

function apply_rules_template(rules_body: string): string {
	const rules_block = indent_block(rules_body, RULES_INDENT)

	return VANILLA_WITH_RULES_TPL.replace(RULES_PLACEHOLDER, () => rules_block)
}

function merge_eslint_config(existing: string): string {
	if (!is_vanilla_eslint_config(existing)) return existing
	const rules_blocks = extract_rules_inner_blocks(existing)
	if (rules_blocks.length === 0) return generate_eslint_config()

	return apply_rules_template(rules_blocks.join(',\n'))
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

const init_logic_templates = {
	generate_eslint_config,
	merge_eslint_config,
	generate_prettier_config,
	merge_prettier_config,
	generate_playwright_config,
}

export { init_logic_templates }

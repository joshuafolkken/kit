import strip_json_comments from 'strip-json-comments'

type ProjectType = 'sveltekit' | 'vanilla'

const NPMRC_LINES: ReadonlyArray<string> = [
	'@joshuafolkken:registry=https://npm.pkg.github.com',
	'engine-strict=true',
	'minimum-release-age=1440',
]

const CSPELL_IMPORT = '"@joshuafolkken/config/cspell"'

const LEFTHOOK_INSTALL_CMD = 'lefthook install'

const AI_COPY_FILES: ReadonlyArray<string> = [
	'CLAUDE.md',
	'AGENTS.md',
	'GEMINI.md',
	'.cursorrules',
	'.coderabbit.yaml',
	'.gitattributes',
	'.gitignore',
	'.mcp.json',
	'.ncurc.json',
	'.prettierignore',
	'SECURITY.md',
	'pnpm-workspace.yaml',
	'sonar-project.properties',
	'tsconfig.sonar.json',
	'wrangler.jsonc',
	'.github/workflows/ci.yml',
	'.github/workflows/auto-tag.yml',
	'.github/workflows/production.yml',
	'.github/workflows/sonar-cube.yml',
	'.github/pull_request_template.md',
]

const AI_COPY_DIRECTORIES: ReadonlyArray<string> = ['prompts', 'scripts-ai']

const LEFTHOOK_EXTENDS: Record<ProjectType, string> = {
	sveltekit: 'node_modules/@joshuafolkken/config/lefthook/sveltekit.yml',
	vanilla: 'node_modules/@joshuafolkken/config/lefthook/vanilla.yml',
}

const TSCONFIG_EXTENDS: Record<ProjectType, string> = {
	sveltekit: '@joshuafolkken/config/tsconfig/sveltekit',
	vanilla: '@joshuafolkken/config/tsconfig/base',
}

/* eslint-disable @typescript-eslint/naming-convention */
const SUGGESTED_SCRIPTS_COMMON: Record<string, string> = {
	postinstall: LEFTHOOK_INSTALL_CMD,
	lint: 'pnpm lint:prettier && pnpm lint:eslint',
	'lint:prettier': 'prettier --check .',
	'lint:eslint': 'eslint . --cache --cache-strategy content',
	format: 'pnpm format:prettier && pnpm format:eslint',
	'format:prettier': 'prettier --write .',
	'format:eslint': 'eslint . --fix --cache --cache-strategy content',
	cspell: 'cspell lint --no-must-find-files --no-progress "**/*.{ts,js,md,yaml,yml,json}"',
	'cspell:dot': 'pnpm cspell . --dot',
	'test:unit': 'vitest run',
	'prevent-main-commit': 'tsx node_modules/@joshuafolkken/config/scripts/prevent-main-commit.ts',
	'check-commit-message': 'tsx node_modules/@joshuafolkken/config/scripts/check-commit-message.ts',
	'audit:security': 'tsx node_modules/@joshuafolkken/config/scripts/security-audit.ts',
	'lefthook:install': LEFTHOOK_INSTALL_CMD,
	'lefthook:uninstall': 'lefthook uninstall',
	'lefthook:commit': 'lefthook run pre-commit',
	'lefthook:push': 'lefthook run pre-push',
	'main:sync': 'git checkout main && git pull',
	'main:merge': 'git pull origin main',
	git: 'tsx scripts-ai/git-workflow.ts',
	'git:followup': 'tsx scripts-ai/git-followup-workflow.ts',
	'telegram:test': 'tsx --env-file=.env scripts-ai/telegram-test.ts',
	'issue:prep': 'tsx scripts-ai/issue-prep.ts',
	prep: 'tsx scripts-ai/prep.ts',
}

const SUGGESTED_SCRIPTS_SVELTEKIT: Record<string, string> = {
	check: 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json',
	'check:ci': 'svelte-kit sync && svelte-check --tsconfig ./tsconfig.json --threshold error',
}
/* eslint-enable @typescript-eslint/naming-convention */

const ESLINT_SVELTEKIT = `import { create_sveltekit_config } from '@joshuafolkken/config/eslint/sveltekit'
import svelteConfig from './svelte.config.js'

export default create_sveltekit_config({
\tgitignore_path: new URL('./.gitignore', import.meta.url),
\ttsconfig_root_dir: import.meta.dirname,
\tsvelte_config: svelteConfig,
})
`

const ESLINT_VANILLA = `import { create_vanilla_config } from '@joshuafolkken/config/eslint/vanilla'

export default create_vanilla_config({
\tgitignore_path: new URL('./.gitignore', import.meta.url),
\ttsconfig_root_dir: import.meta.dirname,
})
`

const PRETTIER_CONFIG = `import { config } from '@joshuafolkken/config/prettier'

export default {
\t...config,
}
`

function generate_eslint_config(type: ProjectType): string {
	return type === 'sveltekit' ? ESLINT_SVELTEKIT : ESLINT_VANILLA
}

function generate_prettier_config(): string {
	return PRETTIER_CONFIG
}

function generate_tsconfig(type: ProjectType): string {
	const value =
		type === 'sveltekit'
			? { extends: ['./.svelte-kit/tsconfig.json', TSCONFIG_EXTENDS.sveltekit] }
			: { extends: TSCONFIG_EXTENDS.vanilla }

	return `${JSON.stringify(value, undefined, '\t')}\n`
}

function generate_lefthook_config(type: ProjectType): string {
	return `extends:\n  - ${LEFTHOOK_EXTENDS[type]}\n`
}

const PLAYWRIGHT_CONFIG = `import { create_playwright_config } from '@joshuafolkken/config/playwright/base'

export default create_playwright_config({
\tdev_port: 5173,
\tpreview_port: 4173,
})
`

function generate_playwright_config(): string {
	return PLAYWRIGHT_CONFIG
}

function generate_cspell_config(): string {
	return `version: '0.2'\nimport:\n  - ${CSPELL_IMPORT}\nwords: []\nignorePaths: []\n`
}

function generate_npmrc(): string {
	return `${NPMRC_LINES.join('\n')}\n`
}

function merge_npmrc(content: string): string {
	const missing = NPMRC_LINES.filter((line) => !content.includes(line))
	if (missing.length === 0) return content
	const prefix = content.length > 0 && !content.endsWith('\n') ? `${content}\n` : content

	return `${prefix}${missing.join('\n')}\n`
}

interface WithExtends {
	extends?: string | Array<string>
}

interface WithScripts extends Record<string, unknown> {
	scripts?: Record<string, string>
}

function normalize_extends(value: string | Array<string> | undefined): Array<string> {
	if (value === undefined) return []
	if (typeof value === 'string') return [value]

	return [...value]
}

function parse_jsonc(content: string): unknown {
	return JSON.parse(strip_json_comments(content, { trailingCommas: true }))
}

function merge_json_extends(content: string, entry: string): string {
	const parsed = parse_jsonc(content) as WithExtends & Record<string, unknown>
	const existing = normalize_extends(parsed.extends)
	if (existing.includes(entry)) return content
	parsed.extends = [entry, ...existing]

	return `${JSON.stringify(parsed, undefined, '\t')}\n`
}

function merge_json_array_field(
	content: string,
	key: string,
	values: ReadonlyArray<string>,
): string {
	const parsed = parse_jsonc(content) as Record<string, unknown>
	const existing = (parsed[key] as Array<string> | undefined) ?? []
	const to_add = values.filter((value) => !existing.includes(value))
	if (to_add.length === 0) return content
	parsed[key] = [...existing, ...to_add]

	return `${JSON.stringify(parsed, undefined, '\t')}\n`
}

function merge_json_object(content: string, updates: Record<string, unknown>): string {
	const parsed = parse_jsonc(content) as Record<string, unknown>
	let has_changes = false

	for (const [key, value] of Object.entries(updates)) {
		if (!(key in parsed)) {
			parsed[key] = value
			has_changes = true
		}
	}

	if (!has_changes) return content

	return `${JSON.stringify(parsed, undefined, '\t')}\n`
}

function get_trailing_newline(content: string): string {
	return content.endsWith('\n') ? '' : '\n'
}

function merge_yaml_list_entry(content: string, key: string, value: string): string {
	if (content.includes(value)) return content
	const entry = `  - ${value}`
	if (content.includes(`${key}:`)) return content.replace(`${key}:`, `${key}:\n${entry}`)

	return `${content}${get_trailing_newline(content)}${key}:\n${entry}\n`
}

function find_version_line_end(content: string): number {
	const start = content.search(/^version:/mu)
	if (start === -1) return -1

	return content.indexOf('\n', start)
}

function merge_cspell_import(content: string, value: string): string {
	if (content.includes(value)) return content
	if (content.includes('import:')) return merge_yaml_list_entry(content, 'import', value)
	const block = `import:\n  - ${value}\n`
	const version_line_end = find_version_line_end(content)
	if (version_line_end === -1) return `${content}${get_trailing_newline(content)}${block}`

	return `${content.slice(0, version_line_end + 1)}${block}${content.slice(version_line_end + 1)}`
}

function get_tsconfig_extends_entry(type: ProjectType): string {
	return TSCONFIG_EXTENDS[type]
}

function get_lefthook_extends_value(type: ProjectType): string {
	return LEFTHOOK_EXTENDS[type]
}

function get_cspell_import_value(): string {
	return CSPELL_IMPORT
}

function get_npmrc_lines(): ReadonlyArray<string> {
	return NPMRC_LINES
}

function get_ai_copy_files(): ReadonlyArray<string> {
	return AI_COPY_FILES
}

function get_ai_copy_directories(): ReadonlyArray<string> {
	return AI_COPY_DIRECTORIES
}

function get_suggested_scripts(type: ProjectType): Record<string, string> {
	if (type === 'sveltekit') return { ...SUGGESTED_SCRIPTS_COMMON, ...SUGGESTED_SCRIPTS_SVELTEKIT }

	return SUGGESTED_SCRIPTS_COMMON
}

function merge_package_scripts(content: string, scripts: Record<string, string>): string {
	const parsed = parse_jsonc(content) as WithScripts
	const existing = parsed.scripts ?? {}
	const to_add = Object.entries(scripts).filter(([key]) => !(key in existing))

	if (to_add.length === 0) return content

	parsed.scripts = { ...existing, ...Object.fromEntries(to_add) }

	return `${JSON.stringify(parsed, undefined, '\t')}\n`
}

const init_logic = {
	generate_eslint_config,
	generate_prettier_config,
	generate_tsconfig,
	generate_lefthook_config,
	generate_cspell_config,
	generate_playwright_config,
	generate_npmrc,
	merge_npmrc,
	merge_json_extends,
	merge_json_array_field,
	merge_json_object,
	merge_yaml_list_entry,
	merge_cspell_import,
	get_tsconfig_extends_entry,
	get_lefthook_extends_value,
	get_cspell_import_value,
	get_npmrc_lines,
	get_ai_copy_files,
	get_ai_copy_directories,
	get_suggested_scripts,
	merge_package_scripts,
}

export { init_logic }
export type { ProjectType }

import strip_json_comments from 'strip-json-comments'
import { apply_jf_migrations, remove_retired_scripts } from './init-logic-migrate'
import { init_logic_sonar } from './init-logic-sonar'
import { init_logic_templates } from './init-logic-templates'
import { init_logic_vite } from './init-logic-vite'
import { init_logic_workspace } from './init-logic-workspace'

type ProjectType = 'sveltekit' | 'vanilla'

const NPMRC_LINES: ReadonlyArray<string> = [
	'@joshuafolkken:registry=https://npm.pkg.github.com',
	'//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}',
	'engine-strict=true',
	'minimum-release-age=1440',
]

const CSPELL_IMPORT: Record<ProjectType, string> = {
	sveltekit: '"@joshuafolkken/kit/cspell/sveltekit"',
	vanilla: '"@joshuafolkken/kit/cspell"',
}

const LEFTHOOK_INSTALL_CMD = 'lefthook install'

const AI_COPY_FILES: ReadonlyArray<string> = [
	'CLAUDE.md',
	'AGENTS.md',
	'GEMINI.md',
	'CODE_OF_CONDUCT.md',
	'.cursorrules',
	'.coderabbit.yaml',
	'.gitattributes',
	'.mcp.json',
	'.ncurc.json',
	'.prettierignore',
	'SECURITY.md',
	'pnpm-workspace.yaml',
	'tsconfig.sonar.json',
	'wrangler.jsonc',
	'.github/workflows/auto-tag.yml',
	'.github/workflows/production.yml',
	'.github/workflows/sonar-cube.yml',
	'.github/pull_request_template.md',
	'.github/release.yml',
]

interface FileCopyMapping {
	src: string
	dest: string
}

const AI_COPY_FILE_MAPPINGS: ReadonlyArray<FileCopyMapping> = [
	{ src: 'templates/gitignore', dest: '.gitignore' },
	{ src: 'templates/workflows/ci.yml', dest: '.github/workflows/ci.yml' },
]

const AI_COPY_DIRECTORIES: ReadonlyArray<string> = []

const PROMPTS_PACKAGE_PREFIX = 'node_modules/@joshuafolkken/kit/prompts/'

const LEFTHOOK_EXTENDS: Record<ProjectType, string> = {
	sveltekit: 'node_modules/@joshuafolkken/kit/lefthook/sveltekit.yml',
	vanilla: 'node_modules/@joshuafolkken/kit/lefthook/vanilla.yml',
}

const TSCONFIG_EXTENDS: Record<ProjectType, string> = {
	sveltekit: './node_modules/@joshuafolkken/kit/tsconfig/sveltekit.jsonc',
	vanilla: './node_modules/@joshuafolkken/kit/tsconfig/base.jsonc',
}

const SUGGESTED_SCRIPTS_COMMON: Record<string, string> = {
	postinstall: LEFTHOOK_INSTALL_CMD,
	josh: 'josh',
}

const SIZE_LIMIT_VERSION = '^12.1.0'
const VISUALIZER_VERSION = '^7.0.1'

const SIZE_LIMIT_CONFIG = [
	{ path: '.svelte-kit/output/client/_app/immutable/**/*.js', limit: '500 kB' },
] as const satisfies ReadonlyArray<{ path: string; limit: string }>

const SUGGESTED_SCRIPTS_SVELTEKIT: Record<string, string> = {
	'size-limit': 'size-limit',
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

function generate_cspell_config(type: ProjectType): string {
	return `version: '0.2'\nimport:\n  - ${CSPELL_IMPORT[type]}\nwords: []\nignorePaths: []\n`
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

	const separator = content.trim() ? '\n' : ''

	return `${key}:\n${entry}\n${separator}${content}`
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

function get_cspell_import_value(type: ProjectType): string {
	return CSPELL_IMPORT[type]
}

function get_npmrc_lines(): ReadonlyArray<string> {
	return NPMRC_LINES
}

function get_ai_copy_files(): ReadonlyArray<string> {
	return AI_COPY_FILES
}

function get_ai_copy_file_mappings(): ReadonlyArray<FileCopyMapping> {
	return AI_COPY_FILE_MAPPINGS
}

function get_ai_copy_directories(): ReadonlyArray<string> {
	return AI_COPY_DIRECTORIES
}

function get_suggested_scripts(type: ProjectType): Record<string, string> {
	if (type === 'sveltekit') return { ...SUGGESTED_SCRIPTS_COMMON, ...SUGGESTED_SCRIPTS_SVELTEKIT }

	return SUGGESTED_SCRIPTS_COMMON
}

function transform_prompt_paths(content: string): string {
	return content.replaceAll(/`prompts\/([^`]+)`/gu, `\`${PROMPTS_PACKAGE_PREFIX}$1\``)
}

function merge_package_scripts(content: string, scripts: Record<string, string>): string {
	const parsed = parse_jsonc(content) as WithScripts
	const existing = parsed.scripts ?? {}
	const migrated = remove_retired_scripts(apply_jf_migrations(existing))
	const to_add = Object.entries(scripts).filter(([key]) => !(key in migrated))
	const did_migrate = JSON.stringify(migrated) !== JSON.stringify(existing)

	if (!did_migrate && to_add.length === 0) return content

	parsed.scripts = { ...migrated, ...Object.fromEntries(to_add) }

	return `${JSON.stringify(parsed, undefined, '\t')}\n`
}

function merge_development_dependencies(
	content: string,
	additions: Record<string, string>,
): string {
	const parsed = parse_jsonc(content) as Record<string, unknown>
	// eslint-disable-next-line dot-notation -- Record<string, T> requires bracket notation per noPropertyAccessFromIndexSignature
	const existing = (parsed['devDependencies'] as Record<string, string> | undefined) ?? {}
	const to_add = Object.entries(additions).filter(([key]) => !(key in existing))
	if (to_add.length === 0) return content
	// eslint-disable-next-line dot-notation -- Record<string, T> requires bracket notation per noPropertyAccessFromIndexSignature
	parsed['devDependencies'] = { ...existing, ...Object.fromEntries(to_add) }

	return `${JSON.stringify(parsed, undefined, '\t')}\n`
}

function merge_sveltekit_package_json(content: string): string {
	const with_scripts = merge_package_scripts(content, get_suggested_scripts('sveltekit'))
	const with_config = merge_json_object(with_scripts, { 'size-limit': SIZE_LIMIT_CONFIG })

	return merge_development_dependencies(with_config, {
		'size-limit': SIZE_LIMIT_VERSION,
		'rollup-plugin-visualizer': VISUALIZER_VERSION,
	})
}

const init_logic = {
	...init_logic_templates,
	...init_logic_workspace,
	...init_logic_sonar,
	...init_logic_vite,
	generate_tsconfig,
	generate_lefthook_config,
	generate_cspell_config,
	generate_npmrc,
	merge_npmrc,
	merge_json_extends,
	merge_json_array_field,
	merge_json_object,
	merge_yaml_list_entry,
	merge_cspell_import,
	merge_development_dependencies,
	merge_sveltekit_package_json,
	get_tsconfig_extends_entry,
	get_lefthook_extends_value,
	get_cspell_import_value,
	get_npmrc_lines,
	get_ai_copy_files,
	get_ai_copy_file_mappings,
	get_ai_copy_directories,
	get_suggested_scripts,
	merge_package_scripts,
	transform_prompt_paths,
}

export { init_logic }
export type { FileCopyMapping, ProjectType }
export type { SonarIdentifiers } from './init-logic-sonar'

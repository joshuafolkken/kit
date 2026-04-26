import { init_logic_json_merge } from './init-logic-json-merge'
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
	sveltekit: '@joshuafolkken/kit/cspell/sveltekit',
	vanilla: '@joshuafolkken/kit/cspell',
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

const CSPELL_VERSION = '^10.0.0'
const SIZE_LIMIT_VERSION = '^12.1.0'
const SIZE_LIMIT_FILE_KEY = '@size-limit/file'
const SIZE_LIMIT_FILE_VERSION = '^12.1.0'
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
	return `version: '0.2'\nimport:\n  - '${CSPELL_IMPORT[type]}'\nwords: []\nignorePaths: []\n`
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

function merge_sveltekit_package_json(content: string): string {
	const with_scripts = init_logic_json_merge.merge_package_scripts(
		content,
		get_suggested_scripts('sveltekit'),
	)
	const with_config = init_logic_json_merge.merge_json_object(with_scripts, {
		'size-limit': SIZE_LIMIT_CONFIG,
	})

	return init_logic_json_merge.merge_development_dependencies(with_config, {
		cspell: CSPELL_VERSION,
		'size-limit': SIZE_LIMIT_VERSION,
		[SIZE_LIMIT_FILE_KEY]: SIZE_LIMIT_FILE_VERSION,
		'rollup-plugin-visualizer': VISUALIZER_VERSION,
	})
}

const init_logic = {
	...init_logic_templates,
	...init_logic_workspace,
	...init_logic_sonar,
	...init_logic_vite,
	...init_logic_json_merge,
	generate_tsconfig,
	generate_lefthook_config,
	generate_cspell_config,
	generate_npmrc,
	merge_npmrc,
	merge_sveltekit_package_json,
	get_tsconfig_extends_entry,
	get_lefthook_extends_value,
	get_cspell_import_value,
	get_npmrc_lines,
	get_ai_copy_files,
	get_ai_copy_file_mappings,
	get_ai_copy_directories,
	get_suggested_scripts,
	transform_prompt_paths,
}

export { init_logic }
export type { FileCopyMapping, ProjectType }
export type { SonarIdentifiers } from './init-logic-sonar'

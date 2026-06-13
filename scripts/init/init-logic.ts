import { vscode_settings_schema } from '#scripts/schemas'
import { init_logic_deploy_vps } from './init-logic-deploy-vps'
import { init_logic_json_merge } from './init-logic-json-merge'
import { init_logic_sonar } from './init-logic-sonar'
import { init_logic_templates } from './init-logic-templates'
import { init_logic_vite } from './init-logic-vite'
import { init_logic_workspace } from './init-logic-workspace'
import { init_logic_wrangler } from './init-logic-wrangler'

type ProjectType = 'sveltekit' | 'vanilla'

const DEV_ENGINES_VALUE = {
	packageManager: { name: 'pnpm', version: '>=11.0.0-0', onFail: 'error' },
}

const NPMRC_LINES: ReadonlyArray<string> = [
	'@joshuafolkken:registry=https://npm.pkg.github.com',
	'//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}',
	'engine-strict=true',
	'minimum-release-age=1440',
	'confirmModulesPurge=false',
	// Pin full GitHub Packages tarball URLs in the lockfile so pnpm >=11.5 frozen-lockfile
	// installs hit the correct authenticated download path (avoids ERR_PNPM_FETCH_401 on CI).
	'lockfile-include-tarball-url=true',
]

const CSPELL_IMPORT: Record<ProjectType, string> = {
	sveltekit: '@joshuafolkken/kit/cspell/sveltekit',
	vanilla: '@joshuafolkken/kit/cspell',
}

const LEFTHOOK_INSTALL_CMD = 'lefthook install'
const SAFE_CHAIN_CMD = 'pnpm dlx @aikidosec/safe-chain setup-ci'
const FIX_GH_PACKAGES_CMD = 'tsx node_modules/@joshuafolkken/kit/scripts/fix-gh-packages.ts'
// Marker identifying a consumer script that already runs the fix-gh-packages command.
const FIX_GH_PACKAGES_MARKER = 'fix-gh-packages'
const PREPARE_KEY = 'prepare'
// Legacy key: earlier `josh init` runs injected the lifecycle commands here. We now
// migrate a kit-managed `postinstall` (one containing fix-gh-packages) to `prepare`.
const LEGACY_POSTINSTALL_KEY = 'postinstall'
// Guard each command so a missing binary (production / CI installs without dev deps,
// global installs outside a git repo) does not abort `pnpm install`. These are
// developer-only hooks, so they live in `prepare` (local install + pack/publish)
// rather than `postinstall`, which also runs when the package is a consumer dependency.
const GUARDED_LEFTHOOK_CMD = `command -v lefthook >/dev/null 2>&1 && ${LEFTHOOK_INSTALL_CMD}`
const GUARDED_FIX_GH_PACKAGES_CMD = `command -v tsx >/dev/null 2>&1 && ${FIX_GH_PACKAGES_CMD}`
// Tolerate each optional hook individually with `|| true` and chain them with `&&`,
// rather than a blanket trailing `; true`. A blanket `; true` is reached
// unconditionally, so it masks failures of the core steps this command is appended
// to (e.g. `pnpm gen && svelte-kit sync`). Per-command tolerance keeps those core
// steps fail-fast while a missing `lefthook`/`tsx` (or a failing optional hook) still
// exits zero.
const PREPARE_CMD = `(${GUARDED_LEFTHOOK_CMD} || true) && (${GUARDED_FIX_GH_PACKAGES_CMD} || true)`

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
	'.github/workflows/sonar-qube.yml',
	'.github/pull_request_template.md',
	'.github/release.yml',
	'.github/dependabot.yml',
	'.claude/settings.json',
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

// Preset file basename within the package's tsconfig/ directory, used to read the base
// compilerOptions when normalizing a consumer tsconfig.json during sync.
const TSCONFIG_PRESET_FILENAME: Record<ProjectType, string> = {
	sveltekit: 'sveltekit.jsonc',
	vanilla: 'base.jsonc',
}

// extensions.json is distributed in common across project styles, so it is not keyed by ProjectType.
const VSCODE_EXTENSIONS_FILENAME = 'extensions.json'

const VSCODE_SETTINGS_FILENAMES: Record<ProjectType, string> = {
	sveltekit: 'settings.sveltekit.json',
	vanilla: 'settings.json',
}

// Keys that exist in the kit's own .vscode/settings.json for kit development but must
// never be distributed to consumer projects (e.g. SonarLint connected-mode points at the
// kit's own SonarQube project under the kit author's connection id).
const KIT_ONLY_VSCODE_SETTINGS_KEYS: ReadonlySet<string> = new Set([
	'sonarlint.connectedMode.project',
])

const SUGGESTED_SCRIPTS_COMMON: Record<string, string> = {
	preinstall: SAFE_CHAIN_CMD,
	prepare: PREPARE_CMD,
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
	// kit preset first so the later `.svelte-kit/tsconfig.json` (and any project-specific
	// entry) wins on conflicts — matching the order `josh sync` prepends to and all consumers.
	const value =
		type === 'sveltekit'
			? { extends: [TSCONFIG_EXTENDS.sveltekit, './.svelte-kit/tsconfig.json'] }
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

function get_tsconfig_preset_filename(type: ProjectType): string {
	return TSCONFIG_PRESET_FILENAME[type]
}

function get_lefthook_extends_value(type: ProjectType): string {
	return LEFTHOOK_EXTENDS[type]
}

function get_cspell_import_value(type: ProjectType): string {
	return CSPELL_IMPORT[type]
}

function get_vscode_settings_filename(type: ProjectType): string {
	return VSCODE_SETTINGS_FILENAMES[type]
}

function strip_kit_only_vscode_settings(
	settings: Record<string, unknown>,
): Record<string, unknown> {
	const entries = Object.entries(settings).filter(
		([key]) => !KIT_ONLY_VSCODE_SETTINGS_KEYS.has(key),
	)

	return Object.fromEntries(entries)
}

function strip_kit_only_vscode_settings_content(raw: string): string {
	const parsed = vscode_settings_schema.parse(JSON.parse(raw))
	const stripped = strip_kit_only_vscode_settings(parsed)
	if (Object.keys(stripped).length === Object.keys(parsed).length) return raw

	return `${JSON.stringify(stripped, undefined, '\t')}\n`
}

function get_npmrc_lines(): ReadonlyArray<string> {
	return NPMRC_LINES
}

function get_development_engines_value(): typeof DEV_ENGINES_VALUE {
	return DEV_ENGINES_VALUE
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

// Drop the suggested `prepare` when the consumer already runs fix-gh-packages in
// any script, so re-running `josh init` does not re-inject a duplicate hook that
// fights the consumer's intentional consolidation.
function get_suggested_scripts_for_content(
	type: ProjectType,
	content: string,
): Record<string, string> {
	const scripts = get_suggested_scripts(type)
	const has_fix = init_logic_json_merge.package_scripts_include(content, FIX_GH_PACKAGES_MARKER)
	if (!has_fix) return scripts

	return Object.fromEntries(Object.entries(scripts).filter(([key]) => key !== PREPARE_KEY))
}

// Append the guarded lifecycle commands to an existing `prepare` (e.g. a SvelteKit
// `svelte-kit sync`) when no script yet runs fix-gh-packages, so the dev-only hooks
// land in `prepare` instead of being lost when the suggested-scripts merge skips the
// already-present `prepare` key.
function merge_prepare_lifecycle_cmd(content: string): string {
	const has_fix = init_logic_json_merge.package_scripts_include(content, FIX_GH_PACKAGES_MARKER)
	if (has_fix) return content

	return init_logic_json_merge.merge_package_script_suffix(content, PREPARE_KEY, PREPARE_CMD)
}

// Migration: remove a kit-managed `postinstall` (one running the fix-gh-packages
// command) so the lifecycle can be re-added to `prepare`. Matching the full command
// rather than the bare marker avoids stripping a consumer's unrelated postinstall that
// merely mentions `fix-gh-packages` (e.g. `npm run my-fix-gh-packages-helper`).
function strip_managed_postinstall(content: string): string {
	return init_logic_json_merge.remove_script_with_marker(
		content,
		LEGACY_POSTINSTALL_KEY,
		FIX_GH_PACKAGES_CMD,
	)
}

function transform_prompt_paths(content: string): string {
	return content.replaceAll(/`prompts\/([^`]+)`/gu, `\`${PROMPTS_PACKAGE_PREFIX}$1\``)
}

function merge_sveltekit_package_json(content: string): string {
	const with_scripts = init_logic_json_merge.merge_package_scripts(
		content,
		get_suggested_scripts_for_content('sveltekit', content),
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
	...init_logic_deploy_vps,
	...init_logic_wrangler,
	generate_tsconfig,
	generate_lefthook_config,
	generate_cspell_config,
	generate_npmrc,
	merge_npmrc,
	merge_sveltekit_package_json,
	get_tsconfig_extends_entry,
	get_tsconfig_preset_filename,
	get_lefthook_extends_value,
	get_cspell_import_value,
	get_vscode_settings_filename,
	strip_kit_only_vscode_settings,
	strip_kit_only_vscode_settings_content,
	VSCODE_EXTENSIONS_FILENAME,
	get_npmrc_lines,
	get_development_engines_value,
	get_ai_copy_files,
	get_ai_copy_file_mappings,
	get_ai_copy_directories,
	get_suggested_scripts,
	get_suggested_scripts_for_content,
	merge_prepare_lifecycle_cmd,
	strip_managed_postinstall,
	transform_prompt_paths,
}

export { init_logic }
export type { FileCopyMapping, ProjectType }
export type { SonarIdentifiers } from './init-logic-sonar'

import { json_format } from '#scripts/config-merge/json-format'
import { vscode_settings_schema } from '#scripts/schemas'
import { init_logic_deploy_vps } from './init-logic-deploy-vps'
import { init_logic_json_merge } from './init-logic-json-merge'
import { init_logic_secretlint } from './init-logic-secretlint'
import { init_logic_sonar } from './init-logic-sonar'
import { init_logic_templates } from './init-logic-templates'
import { init_logic_workspace } from './init-logic-workspace'
import { init_logic_yaml_merge } from './init-logic-yaml-merge'

const DEV_ENGINES_VALUE = {
	packageManager: { name: 'pnpm', version: '>=11.0.0-0', onFail: 'error' },
}

// The `@joshuafolkken:registry` mapping stays — it is a registry mapping, not a credential,
// and pnpm still honors it from a project .npmrc. The matching `_authToken` line does NOT:
// see OBSOLETE_NPMRC_LINES below.
const NPMRC_LINES: ReadonlyArray<string> = [
	'@joshuafolkken:registry=https://npm.pkg.github.com',
	'engine-strict=true',
	'minimum-release-age=1440',
	'confirmModulesPurge=false',
	// Pin full GitHub Packages tarball URLs in the lockfile so pnpm >=11.5 frozen-lockfile
	// installs hit the correct authenticated download path (avoids ERR_PNPM_FETCH_401 on CI).
	'lockfile-include-tarball-url=true',
]

// pnpm >=11.6 refuses to expand environment variables in registry credentials read from a
// project .npmrc (the file is committed, so expansion could leak the token to an
// attacker-controlled registry). The line below is therefore inert noise — it warns on every
// pnpm invocation while contributing no auth. The token has to come from a source pnpm still
// expands: the user-level ~/.npmrc or `pnpm config set`. Every consumer already carries the
// line, and an insert-if-absent merge cannot repair them, so sync strips it. Only the
// env-var placeholder form is listed: a line holding a literal token is still honored by
// pnpm, so removing it would break a working setup. See joshuafolkken/kit#711.
const OBSOLETE_NPMRC_LINES: ReadonlySet<string> = new Set([
	'//npm.pkg.github.com/:_authToken=${NODE_AUTH_TOKEN}',
])

const CSPELL_IMPORT = '@joshuafolkken/kit/cspell'

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

// `.gitignore` is intentionally NOT a byte-copy mapping — it is union-merged via
// merge_gitignore (init-actions build_file_actions + sync_configs.sync_gitignore) so
// consumer-local entries survive a sync. Only fully-managed files consumers never
// hand-edit stay here.
const AI_COPY_FILE_MAPPINGS: ReadonlyArray<FileCopyMapping> = [
	{ src: 'templates/workflows/ci.yml', dest: '.github/workflows/ci.yml' },
]

const AI_COPY_DIRECTORIES: ReadonlyArray<string> = []

const PROMPTS_PACKAGE_PREFIX = 'node_modules/@joshuafolkken/kit/prompts/'

const LEFTHOOK_EXTENDS = 'node_modules/@joshuafolkken/kit/lefthook/vanilla.yml'

// The preset MUST keep a `.json` extension: Playwright (>= 1.62) appends `.json` to any tsconfig
// `extends` entry that does not already end in it, then hard-throws when the resulting path is
// missing — so a `.jsonc` preset resolves to `*.jsonc.json` and takes down the whole E2E suite
// before a single test runs. A tsconfig is parsed as JSONC regardless of extension, so comments in
// the preset still work. See joshuafolkken/kit#681.
const TSCONFIG_EXTENDS = './node_modules/@joshuafolkken/kit/tsconfig/base.json'

// Preset file basename within the package's tsconfig/ directory, used to read the base
// compilerOptions when normalizing a consumer tsconfig.json during sync.
const TSCONFIG_PRESET_FILENAME = 'base.json'

const TSCONFIG_EXCLUDE_FIELD = 'exclude'

// Directories the kit-distributed configs generate, plus the usual build outputs. `playwright.config.ts`
// points the html reporter at `playwright-report/` and Playwright writes `test-results/` — the report
// holds Playwright's own minified trace-viewer bundle, so a consumer with a broad `include` gets
// thousands of tsc errors from third-party output right after running the E2E suite kit ships the
// config for. The two directories must stay disjoint (Playwright refuses an html output folder nested
// in the tests output folder, and vice versa), so both are excluded rather than consolidated. These
// belong in the CONSUMER file: a consumer `exclude` overrides the extended preset's instead of merging
// with it, so shipping them only in a preset would have no effect. See joshuafolkken/kit#712.
const TSCONFIG_EXCLUDE: ReadonlyArray<string> = [
	'node_modules',
	'build',
	'dist',
	'playwright-report',
	'test-results',
]

// extensions.json is distributed in common across project styles, so it is not keyed by type.
const VSCODE_EXTENSIONS_FILENAME = 'extensions.json'

const VSCODE_SETTINGS_FILENAME = 'settings.json'

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

// prettier resolves its `plugins[]` from the consumer project, not transitively through the kit,
// so every package that uses the kit prettier preset must declare these as devDependencies. The
// preset references all three unconditionally (prettier/index.js → plugins), hence all three are
// added regardless of project — omitting any breaks `prettier`/`josh lint` with a
// "Cannot find package" error. Versions mirror the kit's own devDependencies.
const SORT_IMPORTS_PLUGIN_KEY = '@ianvs/prettier-plugin-sort-imports'
const PRETTIER_SVELTE_PLUGIN_KEY = 'prettier-plugin-svelte'
const PRETTIER_TAILWIND_PLUGIN_KEY = 'prettier-plugin-tailwindcss'
const PRETTIER_PLUGIN_DEV_DEPS: Record<string, string> = {
	[SORT_IMPORTS_PLUGIN_KEY]: '^4.7.1',
	[PRETTIER_SVELTE_PLUGIN_KEY]: '^4.1.1',
	[PRETTIER_TAILWIND_PLUGIN_KEY]: '^0.8.0',
}

// format_json rather than JSON.stringify: the `exclude` array fits on one line, and that is how
// prettier emits it — a multi-line array would fail `prettier --check` in the consumer (#660).
function generate_tsconfig(): string {
	return json_format.format_json({
		extends: TSCONFIG_EXTENDS,
		[TSCONFIG_EXCLUDE_FIELD]: TSCONFIG_EXCLUDE,
	})
}

// Union-merge kit's generated-output entries into an existing consumer `exclude`: entries the
// consumer authored are kept verbatim and only the missing ones are appended, so an already-merged
// file is a no-op. Insert-if-absent on the file as a whole would never repair the installed base,
// which is the whole point here — every current consumer has a tsconfig already.
function merge_tsconfig_exclude(content: string): string {
	const field = TSCONFIG_EXCLUDE_FIELD

	return init_logic_json_merge.merge_json_array_field(content, field, TSCONFIG_EXCLUDE)
}

function generate_lefthook_config(): string {
	return `extends:\n  - ${LEFTHOOK_EXTENDS}\n`
}

function generate_cspell_config(): string {
	return `version: "0.2"\nimport:\n  - "${CSPELL_IMPORT}"\nwords: []\nignorePaths: []\n`
}

function generate_npmrc(): string {
	return `${NPMRC_LINES.join('\n')}\n`
}

// Append `missing` lines to `existing`, inserting a separating newline when the base is
// non-empty and lacks a trailing one. Returns `existing` untouched when nothing is missing.
function append_missing_lines(existing: string, missing: ReadonlyArray<string>): string {
	if (missing.length === 0) return existing
	const prefix = existing.length > 0 && !existing.endsWith('\n') ? `${existing}\n` : existing

	return `${prefix}${missing.join('\n')}\n`
}

function is_obsolete_npmrc_line(line: string): boolean {
	return OBSOLETE_NPMRC_LINES.has(line.trim())
}

// Drop obsolete lines while leaving every other line — and the trailing newline — verbatim.
// Returns `content` untouched when nothing matches, so sync reports "unchanged".
function has_obsolete_npmrc_line(content: string): boolean {
	return content.split('\n').some((line) => is_obsolete_npmrc_line(line))
}

function strip_obsolete_npmrc_lines(content: string): string {
	if (!has_obsolete_npmrc_line(content)) return content

	return content
		.split('\n')
		.filter((line) => !is_obsolete_npmrc_line(line))
		.join('\n')
}

function merge_npmrc(content: string): string {
	const stripped = strip_obsolete_npmrc_lines(content)
	const missing = NPMRC_LINES.filter((line) => !stripped.includes(line))

	return append_missing_lines(stripped, missing)
}

// A gitignore line worth appending during a union merge: real ignore patterns only.
// Comments and blank lines are skipped so re-syncing never accumulates orphaned section
// headers detached from their entries.
function is_gitignore_pattern(line: string): boolean {
	const trimmed = line.trim()

	return trimmed.length > 0 && !trimmed.startsWith('#')
}

// Union-merge the kit .gitignore template into an existing consumer file: keep every
// consumer line verbatim and append only the template patterns not already present.
// Matching is per-line (not substring) so `.env` is still appended when only `.env.local`
// exists. Order-stable and idempotent — re-running on an already-merged file is a no-op.
function merge_gitignore(existing: string, template: string): string {
	const existing_lines = new Set(existing.split('\n'))
	const missing = template
		.split('\n')
		.filter((line) => is_gitignore_pattern(line) && !existing_lines.has(line))

	return append_missing_lines(existing, missing)
}

function get_tsconfig_extends_entry(): string {
	return TSCONFIG_EXTENDS
}

function get_tsconfig_preset_filename(): string {
	return TSCONFIG_PRESET_FILENAME
}

function get_tsconfig_exclude_entries(): ReadonlyArray<string> {
	return TSCONFIG_EXCLUDE
}

function get_lefthook_extends_value(): string {
	return LEFTHOOK_EXTENDS
}

function get_cspell_import_value(): string {
	return CSPELL_IMPORT
}

function get_vscode_settings_filename(): string {
	return VSCODE_SETTINGS_FILENAME
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

function get_suggested_scripts(): Record<string, string> {
	return SUGGESTED_SCRIPTS_COMMON
}

// Drop the suggested `prepare` when the consumer already runs fix-gh-packages in
// any script, so re-running `josh init` does not re-inject a duplicate hook that
// fights the consumer's intentional consolidation.
function get_suggested_scripts_for_content(content: string): Record<string, string> {
	const scripts = get_suggested_scripts()
	const has_fix = init_logic_json_merge.has_package_scripts_marker(content, FIX_GH_PACKAGES_MARKER)
	if (!has_fix) return scripts

	return Object.fromEntries(Object.entries(scripts).filter(([key]) => key !== PREPARE_KEY))
}

// Append the guarded lifecycle commands to an existing `prepare` when no script yet runs
// fix-gh-packages, so the dev-only hooks land in `prepare` instead of being lost when the
// suggested-scripts merge skips the already-present `prepare` key.
function merge_prepare_lifecycle_cmd(content: string): string {
	const has_fix = init_logic_json_merge.has_package_scripts_marker(content, FIX_GH_PACKAGES_MARKER)
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
	return content.replaceAll(
		/`prompts\/([^`]+)`/gu,
		(_match, prompt_path: string) => `\`${PROMPTS_PACKAGE_PREFIX}${prompt_path}\``,
	)
}

function merge_prettier_plugin_development_deps(content: string): string {
	return init_logic_json_merge.merge_development_dependencies(content, PRETTIER_PLUGIN_DEV_DEPS)
}

const init_logic = {
	...init_logic_templates,
	...init_logic_workspace,
	...init_logic_sonar,
	...init_logic_json_merge,
	...init_logic_secretlint,
	...init_logic_yaml_merge,
	...init_logic_deploy_vps,
	generate_tsconfig,
	merge_tsconfig_exclude,
	get_tsconfig_exclude_entries,
	generate_lefthook_config,
	generate_cspell_config,
	generate_npmrc,
	merge_npmrc,
	has_obsolete_npmrc_line,
	merge_gitignore,
	merge_prettier_plugin_development_deps,
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
export type { FileCopyMapping }
export type { SonarIdentifiers } from './init-logic-sonar'

import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { init_logic } from '#scripts/init/init-logic'
import { PACKAGE_DIR } from '#scripts/init/init-paths'
import { string_array_schema, vscode_settings_schema } from '#scripts/schemas'

type MergeFunction = (existing: string) => string

const TSCONFIG_PRESET_DIR = 'tsconfig'
const GITIGNORE_TEMPLATE_PATH = 'templates/gitignore'

function sync_with_merge(
	destination_path: string,
	destination_name: string,
	merge_function: MergeFunction,
): void {
	if (!existsSync(destination_path)) return

	const existing = readFileSync(destination_path, 'utf8')
	const merged = merge_function(existing)

	if (merged === existing) {
		console.info(`  ✔ unchanged ${destination_name}`)

		return
	}

	writeFileSync(destination_path, merged)
	console.info(`  ✔ synced    ${destination_name}`)
}

// Point the credential somewhere pnpm still expands. A consumer on pnpm < 11.6 (the range
// devEngines still allows) may have had the removed line working, so losing it silently would
// surface later as an unexplained 401 during install. The second destination is not a detail:
// a builder outside GitHub Actions has neither ~/.npmrc nor actions/setup-node, and its 401
// lands at deploy time where no CI check can see it (joshuafolkken/kit#746).
const NPMRC_CREDENTIAL_NOTICE = [
	'    ℹ removed the GitHub Packages auth line pnpm ignores in a project .npmrc',
	'      → developer machine: keep the credential in ~/.npmrc',
	'      → builder with no ~/.npmrc (Cloudflare, Vercel, Docker): docs/authentication.md §4',
].join('\n')

function sync_npmrc(destination_path: string): void {
	const existing = existsSync(destination_path) ? readFileSync(destination_path, 'utf8') : ''
	const did_have_obsolete_line = init_logic.has_obsolete_npmrc_line(existing)

	sync_with_merge(destination_path, '.npmrc', init_logic.merge_npmrc)
	if (did_have_obsolete_line) console.info(NPMRC_CREDENTIAL_NOTICE)
}

// Union-merge kit's .gitignore entries into the consumer file instead of overwriting it,
// so project-local ignore lines (e.g. an app's output dir) survive a sync.
function sync_gitignore(destination_path: string): void {
	const template = readFileSync(path.join(PACKAGE_DIR, GITIGNORE_TEMPLATE_PATH), 'utf8')

	sync_with_merge(destination_path, '.gitignore', (existing) =>
		init_logic.merge_gitignore(existing, template),
	)
}

function sync_eslint_config(destination_path: string): void {
	sync_with_merge(destination_path, 'eslint.config.js', (existing) =>
		init_logic.merge_eslint_config(existing),
	)
}

function read_base_compiler_options(): Record<string, unknown> {
	const filename = init_logic.get_tsconfig_preset_filename()
	const content = readFileSync(path.join(PACKAGE_DIR, TSCONFIG_PRESET_DIR, filename), 'utf8')

	return init_logic.extract_compiler_options(content)
}

// Ensure the kit preset is in `extends`, drop any compilerOptions key whose value already equals
// that preset — removing per-project drift while preserving genuine overrides — and union-merge the
// generated-output directories into `exclude` so an existing consumer is repaired, not just a new one.
function sync_tsconfig(destination_path: string): void {
	const entry = init_logic.get_tsconfig_extends_entry()
	const base_options = read_base_compiler_options()

	const base_directory = path.dirname(destination_path)

	sync_with_merge(destination_path, 'tsconfig.json', (existing) =>
		init_logic.merge_tsconfig_exclude(
			init_logic.strip_redundant_compiler_options(
				init_logic.merge_tsconfig_extends(existing, entry, base_directory),
				base_options,
			),
		),
	)
}

function sync_cspell_config(destination_path: string): void {
	const value = init_logic.get_cspell_import_value()

	sync_with_merge(destination_path, 'cspell.config.yaml', (existing) =>
		init_logic.merge_cspell_import(existing, value),
	)
}

function sync_lefthook_config(destination_path: string): void {
	const value = init_logic.get_lefthook_extends_value()

	sync_with_merge(destination_path, 'lefthook.yml', (existing) =>
		init_logic.merge_lefthook_extends(existing, value),
	)
}

// Create-only, unlike the merge-based syncs above: once `.secretlintrc.json` exists its rule
// list is project-owned (custom patterns, deliberate exclusions), so syncing must not rewrite
// it. Projects initialized before the secretlint rule existed still get the file here.
function sync_secretlint_config(destination_path: string): void {
	if (existsSync(destination_path)) {
		console.info('  ✔ unchanged .secretlintrc.json')

		return
	}

	writeFileSync(destination_path, init_logic.generate_secretlint_config())
	console.info('  ✔ created   .secretlintrc.json')
}

function read_kit_vscode_json(filename: string): unknown {
	return JSON.parse(readFileSync(path.join(PACKAGE_DIR, '.vscode', filename), 'utf8'))
}

function read_vscode_recommendations(): ReadonlyArray<string> {
	const parsed = vscode_settings_schema.parse(
		read_kit_vscode_json(init_logic.VSCODE_EXTENSIONS_FILENAME),
	)
	// eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature requires bracket notation for Record type
	const raw = parsed['recommendations']

	return string_array_schema.parse(raw)
}

function sync_vscode_extensions_json(destination_path: string): void {
	const recommendations = read_vscode_recommendations()

	sync_with_merge(destination_path, '.vscode/extensions.json', (existing) =>
		init_logic.merge_json_array_field(existing, 'recommendations', recommendations),
	)
}

function sync_vscode_settings_json(destination_path: string): void {
	const raw_settings = read_kit_vscode_json(init_logic.get_vscode_settings_filename())
	const settings_data = init_logic.strip_kit_only_vscode_settings(
		vscode_settings_schema.parse(raw_settings),
	)

	sync_with_merge(destination_path, '.vscode/settings.json', (existing) =>
		init_logic.merge_json_object(existing, settings_data),
	)
}

const sync_configs = {
	sync_npmrc,
	sync_gitignore,
	sync_eslint_config,
	sync_tsconfig,
	sync_cspell_config,
	sync_lefthook_config,
	sync_secretlint_config,
	sync_vscode_extensions_json,
	sync_vscode_settings_json,
}

export { sync_configs }

#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { package_version_schema, with_package_manager_schema } from '#scripts/schemas'
import { sync } from '#scripts/sync/sync'
import { package_manager_version } from '#scripts/version/package-manager-version'
import { execaSync } from 'execa'
import { init_actions, PRETTIER_CONFIG_JS, type FileAction } from './init-actions'
import { init_ai_copy } from './init-ai-copy'
import { init_logic } from './init-logic'
import { PROJECT_ROOT } from './init-paths'

const PACKAGE_JSON = 'package.json'
const KIT_PACKAGE_NAME = '@joshuafolkken/kit'
const SAMPLE_INDENT_WIDTH = 4
const SAMPLE_INDENT = ' '.repeat(SAMPLE_INDENT_WIDTH)

function write_new_file(action: FileAction, destination_path: string): void {
	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, action.create())
	console.info(`  ✔ created   ${action.dest}`)
}

function show_sample(action: FileAction): void {
	console.info(`  ⚠ exists    ${action.dest} — add manually:`)
	console.info('')
	console.info(action.create().replaceAll(/^/gmu, () => SAMPLE_INDENT))
}

function merge_existing_file(
	merge_function: (existing: string) => string,
	destination_path: string,
	destination: string,
): void {
	const existing = readFileSync(destination_path, 'utf8')
	const merged = merge_function(existing)

	if (merged === existing) {
		console.info(`  ✔ unchanged ${destination}`)

		return
	}

	writeFileSync(destination_path, merged)
	console.info(`  ✔ updated   ${destination}`)
}

function execute_file_action(action: FileAction): void {
	const destination_path = path.join(PROJECT_ROOT, action.dest)
	const is_existing = existsSync(destination_path)

	if (!is_existing) {
		write_new_file(action, destination_path)

		return
	}

	if (action.merge === undefined) {
		show_sample(action)

		return
	}

	merge_existing_file(action.merge, destination_path, action.dest)
}

function get_kit_package_manager(): string | undefined {
	const { packageManager: package_manager } = with_package_manager_schema.parse(
		init_actions.read_package_json(PACKAGE_JSON),
	)

	return package_manager !== undefined && package_manager.length > 0 ? package_manager : undefined
}

function get_kit_development_engines(): Record<string, unknown> {
	return init_logic.get_development_engines_value()
}

// Pin the kit to its own published version so the generated configs (which all import
// `@joshuafolkken/kit/...`) resolve. Exact pin matches the consumer convention.
function get_kit_self_dependency(): Record<string, string> {
	const { version } = package_version_schema.parse(init_actions.read_package_json(PACKAGE_JSON))

	return { [KIT_PACKAGE_NAME]: version }
}

function apply_dependency_merges(content: string): string {
	const migrated = init_logic.strip_managed_postinstall(content)
	const merged = init_logic.merge_package_scripts(
		migrated,
		init_logic.get_suggested_scripts_for_content(migrated),
	)
	const with_prettier = init_logic.merge_prettier_plugin_development_deps(merged)

	return init_logic.merge_development_dependencies(with_prettier, get_kit_self_dependency())
}

function apply_package_json_merges(content: string): string {
	const with_kit = apply_dependency_merges(content)
	const with_lifecycle = init_logic.merge_prepare_lifecycle_cmd(with_kit)
	const kit_pm = get_kit_package_manager()
	const with_pm =
		kit_pm === undefined ? with_lifecycle : init_logic.merge_package_manager(with_lifecycle, kit_pm)
	const with_de = init_logic.merge_development_engines(with_pm, get_kit_development_engines())
	const sorted = init_logic.sort_package_json_keys(with_de)

	// Pin devEngines.packageManager.version to the packageManager just written so a
	// freshly scaffolded (or re-initialized) consumer never trips the pnpm
	// dual-declaration warning.
	return package_manager_version.align_development_engines_version(sorted)
}

function merge_project_package_json(): void {
	const package_json_path = path.join(PROJECT_ROOT, PACKAGE_JSON)
	if (!existsSync(package_json_path)) return

	const existing = readFileSync(package_json_path, 'utf8')
	const merged = apply_package_json_merges(existing)

	if (merged === existing) {
		console.info('  ✔ unchanged package.json')

		return
	}

	writeFileSync(package_json_path, merged)
	console.info('  ✔ updated   package.json')
}

function install_lefthook(): void {
	console.info('\nLefthook:')
	const bin = path.join(PROJECT_ROOT, 'node_modules', '.bin', 'lefthook')
	const result = execaSync(bin, ['install'], { cwd: PROJECT_ROOT, stdio: 'inherit', reject: false })

	if (result.exitCode === undefined) {
		console.warn('  ⚠ lefthook install failed — run it manually: lefthook install')
	}
}

function run_config_file_actions(): void {
	console.info('Config files:')

	if (sync.migrate_prettierrc(path.join(PROJECT_ROOT, PRETTIER_CONFIG_JS))) {
		console.info('  ✔ migrated  .prettierrc → prettier.config.js')
	}

	for (const action of init_actions.build_file_actions()) {
		execute_file_action(action)
	}
}

function main(): void {
	console.info('\n🚀 Initializing @joshuafolkken/kit\n')
	run_config_file_actions()

	console.info('\nPackage scripts:')
	merge_project_package_json()

	console.info('\nAI files:')
	init_ai_copy.run_ai_copies()

	install_lefthook()

	console.info('\n✅ Done.\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const init = {
	copy_ai_file: init_ai_copy.copy_ai_file,
	apply_package_json_merges,
	install_lefthook,
}

export { init }

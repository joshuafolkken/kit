import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { init_logic, type ProjectType } from './init-logic'
import { PACKAGE_DIR } from './init-paths'
import { string_array_schema, vscode_settings_schema } from './schemas'

const VSCODE_FILENAMES: Record<ProjectType, { extensions: string; settings: string }> = {
	sveltekit: { extensions: 'extensions.sveltekit.json', settings: 'settings.sveltekit.json' },
	vanilla: { extensions: 'extensions.json', settings: 'settings.json' },
}

type MergeFunction = (existing: string) => string

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

function sync_with_template(
	destination_path: string,
	destination_name: string,
	template: string,
): void {
	if (!existsSync(destination_path)) return

	const existing = readFileSync(destination_path, 'utf8')

	if (template === existing) {
		console.info(`  ✔ unchanged ${destination_name}`)

		return
	}

	writeFileSync(destination_path, template)
	console.info(`  ✔ synced    ${destination_name}`)
}

function sync_vite_config(destination_path: string): void {
	sync_with_merge(destination_path, 'vite.config.ts', init_logic.merge_vite_config)
}

function sync_npmrc(destination_path: string): void {
	sync_with_merge(destination_path, '.npmrc', init_logic.merge_npmrc)
}

function sync_eslint_config(destination_path: string, type: ProjectType): void {
	sync_with_template(destination_path, 'eslint.config.js', init_logic.generate_eslint_config(type))
}

function sync_tsconfig(destination_path: string, type: ProjectType): void {
	const entry = init_logic.get_tsconfig_extends_entry(type)

	sync_with_merge(destination_path, 'tsconfig.json', (existing) =>
		init_logic.merge_json_extends(existing, entry),
	)
}

function sync_cspell_config(destination_path: string, type: ProjectType): void {
	const value = init_logic.get_cspell_import_value(type)

	sync_with_merge(destination_path, 'cspell.config.yaml', (existing) =>
		init_logic.merge_cspell_import(existing, value),
	)
}

function sync_lefthook_config(destination_path: string, type: ProjectType): void {
	const value = init_logic.get_lefthook_extends_value(type)

	sync_with_merge(destination_path, 'lefthook.yml', (existing) =>
		init_logic.merge_yaml_list_entry(existing, 'extends', value),
	)
}

function read_kit_vscode_json(filename: string): unknown {
	return JSON.parse(readFileSync(path.join(PACKAGE_DIR, '.vscode', filename), 'utf8'))
}

function read_vscode_recommendations(type: ProjectType): ReadonlyArray<string> {
	const parsed = vscode_settings_schema.parse(
		read_kit_vscode_json(VSCODE_FILENAMES[type].extensions),
	)
	// eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature requires bracket notation for Record type
	const raw = parsed['recommendations']

	return string_array_schema.parse(raw)
}

function sync_vscode_extensions_json(destination_path: string, type: ProjectType): void {
	const recommendations = read_vscode_recommendations(type)

	sync_with_merge(destination_path, '.vscode/extensions.json', (existing) =>
		init_logic.merge_json_array_field(existing, 'recommendations', recommendations),
	)
}

function sync_vscode_settings_json(destination_path: string, type: ProjectType): void {
	const settings_data = vscode_settings_schema.parse(
		read_kit_vscode_json(VSCODE_FILENAMES[type].settings),
	)

	sync_with_merge(destination_path, '.vscode/settings.json', (existing) =>
		init_logic.merge_json_object(existing, settings_data),
	)
}

const sync_configs = {
	sync_vite_config,
	sync_npmrc,
	sync_eslint_config,
	sync_tsconfig,
	sync_cspell_config,
	sync_lefthook_config,
	sync_vscode_extensions_json,
	sync_vscode_settings_json,
}

export { sync_configs }

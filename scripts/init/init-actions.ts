import { readFileSync } from 'node:fs'
import path from 'node:path'
import { string_array_schema, vscode_settings_schema } from '#scripts/schemas'
import { init_logic, type ProjectType } from './init-logic'
import { package_path } from './init-paths'

const PRETTIER_CONFIG_JS = 'prettier.config.js'

interface FileAction {
	dest: string
	create: () => string
	merge?: (existing: string) => string
}

function read_package_file(relative_path: string): string {
	return readFileSync(package_path(relative_path), 'utf8')
}

function read_package_json(relative_path: string): unknown {
	return JSON.parse(read_package_file(relative_path))
}

type MergeFunction = (existing: string) => string

function build_action(destination: string, create: () => string, merge: MergeFunction): FileAction {
	return { dest: destination, create, merge }
}

function build_vscode_actions(type: ProjectType): ReadonlyArray<FileAction> {
	const extensions_path = path.join('.vscode', init_logic.VSCODE_EXTENSIONS_FILENAME)
	const settings_path = path.join('.vscode', init_logic.get_vscode_settings_filename(type))
	const extensions_raw = vscode_settings_schema.parse(read_package_json(extensions_path))
	// eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature requires bracket notation for Record type
	const raw_recommendations = extensions_raw['recommendations']
	const recommendations = string_array_schema.parse(raw_recommendations)
	const settings_data = vscode_settings_schema.parse(read_package_json(settings_path))

	return [
		{
			dest: '.vscode/extensions.json',
			create: () => read_package_file(extensions_path),
			merge: (existing) =>
				init_logic.merge_json_array_field(existing, 'recommendations', recommendations),
		},
		{
			dest: '.vscode/settings.json',
			create: () => read_package_file(settings_path),
			merge: (existing) => init_logic.merge_json_object(existing, settings_data),
		},
	]
}

function build_config_file_actions(type: ProjectType): ReadonlyArray<FileAction> {
	const lefthook_extends = init_logic.get_lefthook_extends_value(type)

	return [
		build_action(
			'tsconfig.json',
			() => init_logic.generate_tsconfig(type),
			(existing) =>
				init_logic.merge_json_extends(existing, init_logic.get_tsconfig_extends_entry(type)),
		),
		build_action(
			'cspell.config.yaml',
			() => init_logic.generate_cspell_config(type),
			(existing) =>
				init_logic.merge_cspell_import(existing, init_logic.get_cspell_import_value(type)),
		),
		build_action(
			'lefthook.yml',
			() => init_logic.generate_lefthook_config(type),
			(existing) => init_logic.merge_yaml_list_entry(existing, 'extends', lefthook_extends),
		),
		...build_vscode_actions(type),
	]
}

function build_playwright_action(): FileAction {
	return { dest: 'playwright.config.ts', create: () => init_logic.generate_playwright_config() }
}

function build_eslint_action(type: ProjectType): FileAction {
	return build_action(
		'eslint.config.js',
		() => init_logic.generate_eslint_config(type),
		(existing) => init_logic.merge_eslint_config(existing, type),
	)
}

function build_vite_action(): FileAction {
	return build_action(
		'vite.config.ts',
		() => init_logic.generate_vite_config(),
		(existing) => init_logic.merge_vite_config(existing),
	)
}

function build_file_actions(type: ProjectType): ReadonlyArray<FileAction> {
	return [
		build_action(
			'.npmrc',
			() => init_logic.generate_npmrc(),
			(existing) => init_logic.merge_npmrc(existing),
		),
		build_eslint_action(type),
		build_action(
			PRETTIER_CONFIG_JS,
			() => init_logic.generate_prettier_config(),
			(existing) => init_logic.merge_prettier_config(existing),
		),
		build_playwright_action(),
		...(type === 'sveltekit' ? [build_vite_action()] : []),
		...build_config_file_actions(type),
	]
}

const init_actions = { build_file_actions, read_package_json }

export type { FileAction }
export { init_actions, PRETTIER_CONFIG_JS }

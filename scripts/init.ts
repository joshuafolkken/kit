#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { init_ai_copy } from './init-ai-copy'
import { init_logic, type ProjectType } from './init-logic'
import { package_path, PROJECT_ROOT } from './init-paths'
import { install_josh_bin_section } from './install-bin'
import { string_array_schema, vscode_settings_schema, with_package_manager_schema } from './schemas'
import { sync } from './sync'

const PACKAGE_JSON = 'package.json'
const PRETTIER_CONFIG_JS = 'prettier.config.js'

const VSCODE_FILENAMES: Record<ProjectType, { extensions: string; settings: string }> = {
	sveltekit: { extensions: 'extensions.sveltekit.json', settings: 'settings.sveltekit.json' },
	vanilla: { extensions: 'extensions.json', settings: 'settings.json' },
}

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
	const filenames = VSCODE_FILENAMES[type]
	const extensions_raw = vscode_settings_schema.parse(
		read_package_json(path.join('.vscode', filenames.extensions)),
	)
	// eslint-disable-next-line dot-notation -- noPropertyAccessFromIndexSignature requires bracket notation for Record type
	const raw_recommendations = extensions_raw['recommendations']
	const recommendations = string_array_schema.parse(raw_recommendations)
	const settings_data = vscode_settings_schema.parse(
		read_package_json(path.join('.vscode', filenames.settings)),
	)

	return [
		{
			dest: '.vscode/extensions.json',
			create: () => read_package_file(path.join('.vscode', filenames.extensions)),
			merge: (existing) =>
				init_logic.merge_json_array_field(existing, 'recommendations', recommendations),
		},
		{
			dest: '.vscode/settings.json',
			create: () => read_package_file(path.join('.vscode', filenames.settings)),
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

function build_file_actions(type: ProjectType): ReadonlyArray<FileAction> {
	const vite = build_action(
		'vite.config.ts',
		() => init_logic.generate_vite_config(),
		(existing) => init_logic.merge_vite_config(existing),
	)

	return [
		build_action(
			'.npmrc',
			() => init_logic.generate_npmrc(),
			(existing) => init_logic.merge_npmrc(existing),
		),
		{ dest: 'eslint.config.js', create: () => init_logic.generate_eslint_config(type) },
		build_action(
			PRETTIER_CONFIG_JS,
			() => init_logic.generate_prettier_config(),
			(existing) => init_logic.merge_prettier_config(existing),
		),
		{ dest: 'playwright.config.ts', create: () => init_logic.generate_playwright_config() },
		...(type === 'sveltekit' ? [vite] : []),
		...build_config_file_actions(type),
	]
}

function write_new_file(action: FileAction, destination_path: string): void {
	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, action.create())
	console.info(`  ✔ created   ${action.dest}`)
}

function show_sample(action: FileAction): void {
	console.info(`  ⚠ exists    ${action.dest} — add manually:`)
	console.info('')
	console.info(action.create().replaceAll(/^/gmu, '    '))
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

function detect_project_type(): ProjectType | undefined {
	const has_svelte_config =
		existsSync(path.join(PROJECT_ROOT, 'svelte.config.js')) ||
		existsSync(path.join(PROJECT_ROOT, 'svelte.config.ts'))

	return has_svelte_config ? 'sveltekit' : undefined
}

function parse_cli_type(): ProjectType | undefined {
	const type_index = process.argv.indexOf('--type')
	if (type_index === -1) return undefined
	const raw = process.argv[type_index + 1]

	return raw === 'sveltekit' || raw === 'vanilla' ? raw : undefined
}

async function prompt_project_type(): Promise<ProjectType> {
	const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

	return await new Promise<ProjectType>((resolve) => {
		rl.question('Project type — sveltekit or vanilla? ', (answer) => {
			rl.close()
			resolve(answer.trim() === 'sveltekit' ? 'sveltekit' : 'vanilla')
		})
	})
}

async function resolve_project_type(): Promise<ProjectType> {
	const detected = detect_project_type()

	if (detected !== undefined) {
		console.info(`Detected ${detected} project`)

		return detected
	}

	const from_cli = parse_cli_type()

	if (from_cli !== undefined) return from_cli

	return await prompt_project_type()
}

function get_kit_package_manager(): string | undefined {
	const { packageManager: package_manager } = with_package_manager_schema.parse(
		read_package_json(PACKAGE_JSON),
	)

	return package_manager !== undefined && package_manager.length > 0 ? package_manager : undefined
}

function apply_package_json_merges(content: string, type: ProjectType): string {
	const merged =
		type === 'sveltekit'
			? init_logic.merge_sveltekit_package_json(content)
			: init_logic.merge_package_scripts(content, init_logic.get_suggested_scripts(type))
	const kit_pm = get_kit_package_manager()
	const with_pm = kit_pm === undefined ? merged : init_logic.merge_package_manager(merged, kit_pm)

	return init_logic.sort_package_json_keys(with_pm)
}

function merge_project_package_json(type: ProjectType): void {
	const package_json_path = path.join(PROJECT_ROOT, PACKAGE_JSON)
	if (!existsSync(package_json_path)) return

	const existing = readFileSync(package_json_path, 'utf8')
	const merged = apply_package_json_merges(existing, type)

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
	const result = spawnSync(bin, ['install'], { cwd: PROJECT_ROOT, stdio: 'inherit' })

	if (result.error !== undefined) {
		console.warn('  ⚠ lefthook install failed — run it manually: lefthook install')
	}
}

function run_tool_installs(): void {
	install_lefthook()
	install_josh_bin_section()
}

function run_config_file_actions(type: ProjectType): void {
	console.info('Config files:')

	if (sync.migrate_prettierrc(path.join(PROJECT_ROOT, PRETTIER_CONFIG_JS))) {
		console.info('  ✔ migrated  .prettierrc → prettier.config.js')
	}

	for (const action of build_file_actions(type)) execute_file_action(action)
}

async function main(): Promise<void> {
	const type = await resolve_project_type()

	console.info(`\n🚀 Initializing @joshuafolkken/kit (${type})\n`)
	run_config_file_actions(type)

	console.info('\nPackage scripts:')
	merge_project_package_json(type)

	console.info('\nAI files:')
	init_ai_copy.run_ai_copies()

	run_tool_installs()

	console.info('\n✅ Done.\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

const init = {
	copy_ai_file: init_ai_copy.copy_ai_file,
}

export { init }

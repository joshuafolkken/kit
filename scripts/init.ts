#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { init_logic, type ProjectType } from './init-logic'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_ROOT = process.cwd()

const VSCODE_FILENAMES: Record<ProjectType, { extensions: string; settings: string }> = {
	sveltekit: { extensions: 'extensions.sveltekit.json', settings: 'settings.sveltekit.json' },
	vanilla: { extensions: 'extensions.json', settings: 'settings.json' },
}

interface FileAction {
	dest: string
	create: () => string
	merge?: (existing: string) => string
}

interface VscodeExtensionsJson {
	recommendations?: Array<string>
}

function package_path(relative_path: string): string {
	return path.join(PACKAGE_DIR, relative_path)
}

function read_package_file(relative_path: string): string {
	return readFileSync(package_path(relative_path), 'utf8')
}

function read_package_json(relative_path: string): unknown {
	return JSON.parse(read_package_file(relative_path))
}

function build_npmrc_action(): FileAction {
	return {
		dest: '.npmrc',
		create: () => init_logic.generate_npmrc(),
		merge: (existing) => init_logic.merge_npmrc(existing),
	}
}

function build_tsconfig_action(type: ProjectType): FileAction {
	return {
		dest: 'tsconfig.json',
		create: () => init_logic.generate_tsconfig(type),
		merge: (existing) =>
			init_logic.merge_json_extends(existing, init_logic.get_tsconfig_extends_entry(type)),
	}
}

function build_cspell_action(): FileAction {
	return {
		dest: 'cspell.config.yaml',
		create: () => init_logic.generate_cspell_config(),
		merge: (existing) =>
			init_logic.merge_cspell_import(existing, init_logic.get_cspell_import_value()),
	}
}

function build_lefthook_action(type: ProjectType): FileAction {
	return {
		dest: 'lefthook.yml',
		create: () => init_logic.generate_lefthook_config(type),
		merge: (existing) =>
			init_logic.merge_yaml_list_entry(
				existing,
				'extends',
				init_logic.get_lefthook_extends_value(type),
			),
	}
}

function build_vscode_actions(type: ProjectType): ReadonlyArray<FileAction> {
	const filenames = VSCODE_FILENAMES[type]
	const extensions_data = read_package_json(
		path.join('.vscode', filenames.extensions),
	) as VscodeExtensionsJson
	const settings_data = read_package_json(path.join('.vscode', filenames.settings)) as Record<
		string,
		unknown
	>
	const recommendations = extensions_data.recommendations ?? []

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

function build_file_actions(type: ProjectType): ReadonlyArray<FileAction> {
	return [
		build_npmrc_action(),
		{ dest: 'eslint.config.js', create: () => init_logic.generate_eslint_config(type) },
		{ dest: 'prettier.config.js', create: () => init_logic.generate_prettier_config() },
		{ dest: 'playwright.config.ts', create: () => init_logic.generate_playwright_config() },
		build_tsconfig_action(type),
		build_cspell_action(),
		build_lefthook_action(type),
		...build_vscode_actions(type),
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

function execute_ai_file_copy(filename: string): boolean {
	const destination_path = path.join(PROJECT_ROOT, filename)

	if (existsSync(destination_path)) {
		console.info(`  ⏭ skipped   ${filename} (already exists — run pnpm sync to update)`)

		return true
	}

	mkdirSync(path.dirname(destination_path), { recursive: true })
	cpSync(package_path(filename), destination_path)
	console.info(`  ✔ created   ${filename}`)

	return false
}

function execute_ai_directory_copy(directory_name: string): boolean {
	const destination_path = path.join(PROJECT_ROOT, directory_name)

	if (existsSync(destination_path)) {
		console.info(`  ⏭ skipped   ${directory_name}/ (already exists — run pnpm sync to update)`)

		return true
	}

	cpSync(package_path(directory_name), destination_path, { recursive: true })
	console.info(`  ✔ created   ${directory_name}/`)

	return false
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

function merge_project_scripts(type: ProjectType): void {
	const package_json_path = path.join(PROJECT_ROOT, 'package.json')

	if (!existsSync(package_json_path)) return

	const existing = readFileSync(package_json_path, 'utf8')
	const merged = init_logic.merge_package_scripts(existing, init_logic.get_suggested_scripts(type))

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

function get_repo_name_with_owner(): string | undefined {
	/* eslint-disable sonarjs/no-os-command-from-path */
	const result = spawnSync(
		'gh',
		['repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner'],
		{ encoding: 'utf8', cwd: PROJECT_ROOT },
	)
	/* eslint-enable sonarjs/no-os-command-from-path */
	if (result.status !== 0 || !result.stdout) return undefined

	return result.stdout.trim() || undefined
}

function copy_sonar_file_write(
	template_source: string,
	destination_path: string,
	project_key: string,
	organization: string,
): void {
	const content = init_logic.apply_sonar_template(
		readFileSync(template_source, 'utf8'),
		project_key,
		organization,
	)

	writeFileSync(destination_path, content)
}

function copy_sonar_if_missing(
	destination: string,
	identifiers: ReturnType<typeof init_logic.derive_sonar_identifiers>,
): void {
	const destination_path = path.join(PROJECT_ROOT, destination)

	if (existsSync(destination_path)) {
		console.info(`  ⏭ skipped   ${destination} (already exists — run pnpm sync to update)`)

		return
	}

	const template_source = path.join(PACKAGE_DIR, init_logic.get_sonar_template_source())

	copy_sonar_file_write(
		template_source,
		destination_path,
		identifiers.project_key,
		identifiers.organization,
	)
	console.info(`  ✔ created   ${destination}`)
}

function copy_sonar_with_template(): void {
	const destination = init_logic.get_sonar_template_destination()
	const name_with_owner = get_repo_name_with_owner()

	if (name_with_owner === undefined) {
		console.warn(`  ⚠ skipped   ${destination} (gh repo view failed)`)

		return
	}

	copy_sonar_if_missing(destination, init_logic.derive_sonar_identifiers(name_with_owner))
}

function run_ai_copies(): void {
	const file_skips = init_logic
		.get_ai_copy_files()
		.map((filename) => execute_ai_file_copy(filename))
	const directory_skips = init_logic
		.get_ai_copy_directories()
		.map((directory_name) => execute_ai_directory_copy(directory_name))
	const has_skips = [...file_skips, ...directory_skips].some(Boolean)

	copy_sonar_with_template()

	if (has_skips) {
		console.info('\n  💡 Run `pnpm sync` to overwrite skipped AI files with the latest version.')
	}
}

async function main(): Promise<void> {
	const type = await resolve_project_type()

	console.info(`\n🚀 Initializing @joshuafolkken/config (${type})\n`)
	console.info('Config files:')
	for (const action of build_file_actions(type)) execute_file_action(action)

	console.info('\nPackage scripts:')
	merge_project_scripts(type)

	console.info('\nAI files:')
	run_ai_copies()

	install_lefthook()

	console.info('\n✅ Done.\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

const init = { copy_sonar_file_write }

export { init }

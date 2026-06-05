#!/usr/bin/env tsx
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { with_package_manager_schema } from '#scripts/schemas'
import { sync } from '#scripts/sync/sync'
import { package_manager_version } from '#scripts/version/package-manager-version'
import { execaSync } from 'execa'
import { init_actions, PRETTIER_CONFIG_JS, type FileAction } from './init-actions'
import { init_ai_copy } from './init-ai-copy'
import { init_logic, type ProjectType } from './init-logic'
import { is_sveltekit_project, PROJECT_ROOT } from './init-paths'

const PACKAGE_JSON = 'package.json'

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
	return is_sveltekit_project(PROJECT_ROOT) ? 'sveltekit' : undefined
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
		init_actions.read_package_json(PACKAGE_JSON),
	)

	return package_manager !== undefined && package_manager.length > 0 ? package_manager : undefined
}

function get_kit_development_engines(): Record<string, unknown> {
	return init_logic.get_development_engines_value()
}

function apply_package_json_merges(content: string, type: ProjectType): string {
	const migrated = init_logic.strip_managed_postinstall(content)
	const merged =
		type === 'sveltekit'
			? init_logic.merge_sveltekit_package_json(migrated)
			: init_logic.merge_package_scripts(
					migrated,
					init_logic.get_suggested_scripts_for_content(type, migrated),
				)
	const with_lifecycle = init_logic.merge_prepare_lifecycle_cmd(merged)
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
	const result = execaSync(bin, ['install'], { cwd: PROJECT_ROOT, stdio: 'inherit', reject: false })

	if (result.exitCode === undefined) {
		console.warn('  ⚠ lefthook install failed — run it manually: lefthook install')
	}
}

function run_config_file_actions(type: ProjectType): void {
	console.info('Config files:')

	if (sync.migrate_prettierrc(path.join(PROJECT_ROOT, PRETTIER_CONFIG_JS))) {
		console.info('  ✔ migrated  .prettierrc → prettier.config.js')
	}

	for (const action of init_actions.build_file_actions(type)) execute_file_action(action)
}

async function main(): Promise<void> {
	const type = await resolve_project_type()

	console.info(`\n🚀 Initializing @joshuafolkken/kit (${type})\n`)
	run_config_file_actions(type)

	console.info('\nPackage scripts:')
	merge_project_package_json(type)

	console.info('\nAI files:')
	init_ai_copy.run_ai_copies()

	install_lefthook()

	console.info('\n✅ Done.\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

const init = {
	copy_ai_file: init_ai_copy.copy_ai_file,
	apply_package_json_merges,
	install_lefthook,
}

export { init }

#!/usr/bin/env tsx
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gh_spawn } from './gh-spawn'
import { init_logic } from './init-logic'
import { PACKAGE_DIR, PROJECT_ROOT } from './init-paths'
import { sonar_file } from './sonar-file'

const WORKSPACE_YAML = 'pnpm-workspace.yaml'

function sync_ai_file(source_path: string, destination_path: string): void {
	mkdirSync(path.dirname(destination_path), { recursive: true })
	const content = readFileSync(source_path, 'utf8')

	writeFileSync(destination_path, init_logic.transform_prompt_paths(content))
}

function sync_file(filename: string): void {
	sync_ai_file(path.join(PACKAGE_DIR, filename), path.join(PROJECT_ROOT, filename))
	console.info(`  ✔ synced    ${filename}`)
}

function sync_file_mapping(source_path: string, destination_path: string): void {
	if (!existsSync(source_path)) {
		console.warn(`  ⚠ skipped   ${path.basename(destination_path)} (not found in package)`)

		return
	}

	mkdirSync(path.dirname(destination_path), { recursive: true })
	cpSync(source_path, destination_path)
	console.info(`  ✔ synced    ${path.basename(destination_path)}`)
}

function sync_workspace_yaml(template_path: string, destination_path: string): void {
	const template = readFileSync(template_path, 'utf8')
	const existing = existsSync(destination_path) ? readFileSync(destination_path, 'utf8') : ''
	const merged = init_logic.merge_workspace_yaml(existing, template)

	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, merged)
}

function sync_ai_copy_file(filename: string): void {
	if (filename === WORKSPACE_YAML) {
		sync_workspace_yaml(
			path.join(PACKAGE_DIR, WORKSPACE_YAML),
			path.join(PROJECT_ROOT, WORKSPACE_YAML),
		)
		console.info(`  ✔ synced    ${WORKSPACE_YAML}`)

		return
	}

	sync_file(filename)
}

function sync_directory(directory_name: string): void {
	cpSync(path.join(PACKAGE_DIR, directory_name), path.join(PROJECT_ROOT, directory_name), {
		recursive: true,
	})
	console.info(`  ✔ synced    ${directory_name}/`)
}

function migrate_prettierrc(destination_path: string): boolean {
	const legacy_path = path.join(path.dirname(destination_path), '.prettierrc')
	if (!existsSync(legacy_path)) return false

	const existing = readFileSync(legacy_path, 'utf8')

	writeFileSync(destination_path, init_logic.merge_prettier_config(existing))
	rmSync(legacy_path)

	return true
}

function write_merged_prettier_config(destination_path: string): void {
	const existing = readFileSync(destination_path, 'utf8')
	const merged = init_logic.merge_prettier_config(existing)

	if (merged === existing) {
		console.info('  ✔ unchanged prettier.config.js')

		return
	}

	writeFileSync(destination_path, merged)
	console.info('  ✔ synced    prettier.config.js')
}

function sync_prettier_config(destination_path: string): void {
	if (migrate_prettierrc(destination_path)) {
		console.info('  ✔ migrated  .prettierrc → prettier.config.js')

		return
	}

	if (!existsSync(destination_path)) return

	write_merged_prettier_config(destination_path)
}

function sync_sonar_with_template(): void {
	const destination = init_logic.get_sonar_template_destination()
	const name_with_owner = gh_spawn.get_repo_name_with_owner()

	if (name_with_owner === undefined) {
		console.warn(`  ⚠ skipped   ${destination} (gh repo view failed)`)

		return
	}

	const identifiers = init_logic.derive_sonar_identifiers(name_with_owner)
	const template_source = path.join(PACKAGE_DIR, init_logic.get_sonar_template_source())

	sonar_file.write_sonar_file(template_source, path.join(PROJECT_ROOT, destination), identifiers)
	console.info(`  ✔ synced    ${destination}`)
}

function sync_ai_copy_all(): void {
	console.info('AI files:')

	for (const filename of init_logic.get_ai_copy_files()) {
		sync_ai_copy_file(filename)
	}

	for (const { src, dest } of init_logic.get_ai_copy_file_mappings()) {
		sync_file_mapping(path.join(PACKAGE_DIR, src), path.join(PROJECT_ROOT, dest))
	}

	for (const directory_name of init_logic.get_ai_copy_directories()) {
		sync_directory(directory_name)
	}
}

function main(): void {
	console.info('\n🔄 Syncing @joshuafolkken/kit AI files\n')
	sync_ai_copy_all()
	sync_prettier_config(path.join(PROJECT_ROOT, 'prettier.config.js'))
	sync_sonar_with_template()
	console.info('\n✅ Done.\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const sync = {
	sync_file_mapping,
	sync_ai_file,
	sync_workspace_yaml,
	sync_prettier_config,
	migrate_prettierrc,
}

export { sync }

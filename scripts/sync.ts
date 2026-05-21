#!/usr/bin/env tsx
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { gh_spawn } from './gh-spawn'
import { init_logic } from './init-logic'
import { PACKAGE_DIR, PROJECT_ROOT } from './init-paths'
import { sonar_file } from './sonar-file'

const WORKSPACE_YAML = 'pnpm-workspace.yaml'
const WRANGLER_JSONC = 'wrangler.jsonc'

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

function sync_workspace_yaml(
	template_path: string,
	destination_path: string,
	is_force = false,
): void {
	const template = readFileSync(template_path, 'utf8')
	const existing =
		!is_force && existsSync(destination_path) ? readFileSync(destination_path, 'utf8') : ''
	const merged = init_logic.merge_workspace_yaml(existing, template)

	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, merged)
}

function sync_wrangler_jsonc_merge(source_path: string, destination_path: string): void {
	if (!existsSync(destination_path)) {
		sync_ai_file(source_path, destination_path)

		return
	}

	const template = init_logic.transform_prompt_paths(readFileSync(source_path, 'utf8'))
	const existing = readFileSync(destination_path, 'utf8')

	writeFileSync(destination_path, init_logic.merge_wrangler_jsonc(existing, template))
}

function sync_ai_copy_file(filename: string, is_force: boolean): void {
	if (filename === WORKSPACE_YAML) {
		sync_workspace_yaml(
			path.join(PACKAGE_DIR, WORKSPACE_YAML),
			path.join(PROJECT_ROOT, WORKSPACE_YAML),
			is_force,
		)
		console.info(`  ✔ synced    ${WORKSPACE_YAML}`)

		return
	}

	if (filename === WRANGLER_JSONC && !is_force) {
		sync_wrangler_jsonc_merge(
			path.join(PACKAGE_DIR, WRANGLER_JSONC),
			path.join(PROJECT_ROOT, WRANGLER_JSONC),
		)
		console.info(`  ✔ synced    ${WRANGLER_JSONC}`)

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

function sync_playwright_config(destination_path: string): void {
	if (!existsSync(destination_path)) return

	const template = init_logic.generate_playwright_config()
	const existing = readFileSync(destination_path, 'utf8')

	if (template === existing) {
		console.info('  ✔ unchanged playwright.config.ts')

		return
	}

	writeFileSync(destination_path, template)
	console.info('  ✔ synced    playwright.config.ts')
}

function sync_deploy_vps(destination_path: string): void {
	if (!existsSync(destination_path)) return

	const existing = readFileSync(destination_path, 'utf8')
	const patched = init_logic.patch_deploy_vps_pnpm(existing)

	if (patched === existing) {
		console.info('  ✔ unchanged deploy-vps.yml')

		return
	}

	writeFileSync(destination_path, patched)
	console.info('  ✔ synced    deploy-vps.yml')
}

function sync_sonar_with_template(is_force = false): void {
	const destination = init_logic.get_sonar_template_destination()
	const name_with_owner = gh_spawn.get_repo_name_with_owner()

	if (name_with_owner === undefined) {
		console.warn(`  ⚠ skipped   ${destination} (gh repo view failed)`)

		return
	}

	const template_source = path.join(PACKAGE_DIR, init_logic.get_sonar_template_source())
	const identifiers = init_logic.derive_sonar_identifiers(name_with_owner)
	const write_function = is_force ? sonar_file.write_sonar_file : sonar_file.merge_sonar_file

	write_function(template_source, path.join(PROJECT_ROOT, destination), identifiers)
	console.info(`  ✔ synced    ${destination}`)
}

function sync_ai_copy_all(is_force: boolean): void {
	console.info('AI files:')

	for (const filename of init_logic.get_ai_copy_files()) {
		sync_ai_copy_file(filename, is_force)
	}

	for (const { src, dest } of init_logic.get_ai_copy_file_mappings()) {
		sync_file_mapping(path.join(PACKAGE_DIR, src), path.join(PROJECT_ROOT, dest))
	}

	for (const directory_name of init_logic.get_ai_copy_directories()) {
		sync_directory(directory_name)
	}
}

function main(): void {
	const is_force = process.argv.includes('--force')

	console.info('\n🔄 Syncing @joshuafolkken/kit AI files\n')
	sync_ai_copy_all(is_force)
	sync_prettier_config(path.join(PROJECT_ROOT, 'prettier.config.js'))
	sync_playwright_config(path.join(PROJECT_ROOT, 'playwright.config.ts'))
	sync_deploy_vps(path.join(PROJECT_ROOT, '.github/workflows/deploy-vps.yml'))
	sync_sonar_with_template(is_force)
	console.info('\n✅ Done.\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const sync = {
	sync_file_mapping,
	sync_ai_file,
	sync_workspace_yaml,
	sync_wrangler_jsonc_merge,
	sync_prettier_config,
	sync_playwright_config,
	sync_deploy_vps,
	migrate_prettierrc,
}

export { sync }

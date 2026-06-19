import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { init_logic } from './init-logic'
import { package_path, PROJECT_ROOT } from './init-paths'
import { init_sonar } from './init-sonar'

const WRANGLER_JSONC = 'wrangler.jsonc'
const WORKSPACE_YAML = 'pnpm-workspace.yaml'

function copy_ai_file(source_path: string, destination_path: string): void {
	const content = readFileSync(source_path, 'utf8')

	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, init_logic.transform_prompt_paths(content))
}

function did_skip_copy_if_absent(
	source_path: string,
	destination_path: string,
	label: string,
): boolean {
	if (existsSync(destination_path)) {
		console.info(`  ⏭ skipped   ${label} (already exists — run josh sync to update)`)

		return true
	}

	copy_ai_file(source_path, destination_path)
	console.info(`  ✔ created   ${label}`)

	return false
}

function did_skip_wrangler_jsonc_copy(source_path: string, destination_path: string): boolean {
	if (!existsSync(destination_path)) {
		copy_ai_file(source_path, destination_path)
		console.info(`  ✔ created   ${WRANGLER_JSONC}`)

		return false
	}

	const template = init_logic.transform_prompt_paths(readFileSync(source_path, 'utf8'))
	const existing = readFileSync(destination_path, 'utf8')
	const merged = init_logic.merge_wrangler_jsonc(existing, template)

	if (merged !== existing) writeFileSync(destination_path, merged)
	console.info(`  ✔ updated   ${WRANGLER_JSONC}`)

	return false
}

function did_skip_workspace_yaml_copy(source_path: string, destination_path: string): boolean {
	if (!existsSync(destination_path)) {
		copy_ai_file(source_path, destination_path)
		console.info(`  ✔ created   ${WORKSPACE_YAML}`)

		return false
	}

	const template = readFileSync(source_path, 'utf8')
	const existing = readFileSync(destination_path, 'utf8')
	const merged = init_logic.merge_workspace_yaml(existing, template)

	if (merged !== existing) writeFileSync(destination_path, merged)
	console.info(`  ✔ updated   ${WORKSPACE_YAML}`)

	return false
}

function did_skip_ai_file_copy(filename: string): boolean {
	const source_path = package_path(filename)
	const destination_path = path.join(PROJECT_ROOT, filename)

	if (filename === WRANGLER_JSONC) {
		return did_skip_wrangler_jsonc_copy(source_path, destination_path)
	}

	if (filename === WORKSPACE_YAML) {
		return did_skip_workspace_yaml_copy(source_path, destination_path)
	}

	return did_skip_copy_if_absent(source_path, destination_path, filename)
}

function did_skip_ai_file_mapping(source: string, destination: string): boolean {
	return did_skip_copy_if_absent(
		package_path(source),
		path.join(PROJECT_ROOT, destination),
		destination,
	)
}

function did_skip_ai_directory_copy(directory_name: string): boolean {
	const destination_path = path.join(PROJECT_ROOT, directory_name)

	if (existsSync(destination_path)) {
		console.info(`  ⏭ skipped   ${directory_name}/ (already exists — run josh sync to update)`)

		return true
	}

	cpSync(package_path(directory_name), destination_path, { recursive: true })
	console.info(`  ✔ created   ${directory_name}/`)

	return false
}

function run_ai_copies(): void {
	const file_skips = init_logic
		.get_ai_copy_files()
		.map((filename) => did_skip_ai_file_copy(filename))
	const mapping_skips = init_logic
		.get_ai_copy_file_mappings()
		.map(({ src: source, dest: destination }) => did_skip_ai_file_mapping(source, destination))
	const directory_skips = init_logic
		.get_ai_copy_directories()
		.map((directory_name) => did_skip_ai_directory_copy(directory_name))
	const has_skips = [...file_skips, ...mapping_skips, ...directory_skips].some(Boolean)

	init_sonar.copy_sonar_with_template()

	if (has_skips) {
		console.info('\n  💡 Run `josh sync` to overwrite skipped AI files with the latest version.')
	}
}

const init_ai_copy = {
	copy_ai_file,
	run_ai_copies,
}

export { init_ai_copy }

import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { init_logic } from './init-logic'
import { package_path, PROJECT_ROOT } from './init-paths'
import { init_sonar } from './init-sonar'

function copy_ai_file(source_path: string, destination_path: string): void {
	const content = readFileSync(source_path, 'utf8')

	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, init_logic.transform_prompt_paths(content))
}

function execute_ai_file_copy(filename: string): boolean {
	const destination_path = path.join(PROJECT_ROOT, filename)

	if (existsSync(destination_path)) {
		console.info(`  ⏭ skipped   ${filename} (already exists — run josh sync to update)`)

		return true
	}

	copy_ai_file(package_path(filename), destination_path)
	console.info(`  ✔ created   ${filename}`)

	return false
}

function execute_ai_directory_copy(directory_name: string): boolean {
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
		.map((filename) => execute_ai_file_copy(filename))
	const directory_skips = init_logic
		.get_ai_copy_directories()
		.map((directory_name) => execute_ai_directory_copy(directory_name))
	const has_skips = [...file_skips, ...directory_skips].some(Boolean)

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

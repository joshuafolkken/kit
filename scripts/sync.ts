#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { init_logic } from './init-logic'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const PROJECT_ROOT = process.cwd()

function sync_file(filename: string): void {
	const destination_path = path.join(PROJECT_ROOT, filename)

	mkdirSync(path.dirname(destination_path), { recursive: true })
	cpSync(path.join(PACKAGE_DIR, filename), destination_path)
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

function sync_directory(directory_name: string): void {
	cpSync(path.join(PACKAGE_DIR, directory_name), path.join(PROJECT_ROOT, directory_name), {
		recursive: true,
	})
	console.info(`  ✔ synced    ${directory_name}/`)
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

function sync_sonar_file_write(
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

	mkdirSync(path.dirname(destination_path), { recursive: true })
	writeFileSync(destination_path, content)
}

function sync_sonar_with_template(): void {
	const destination = init_logic.get_sonar_template_destination()
	const name_with_owner = get_repo_name_with_owner()

	if (name_with_owner === undefined) {
		console.warn(`  ⚠ skipped   ${destination} (gh repo view failed)`)

		return
	}

	const { project_key, organization } = init_logic.derive_sonar_identifiers(name_with_owner)
	const template_source = path.join(PACKAGE_DIR, init_logic.get_sonar_template_source())

	sync_sonar_file_write(
		template_source,
		path.join(PROJECT_ROOT, destination),
		project_key,
		organization,
	)
	console.info(`  ✔ synced    ${destination}`)
}

function main(): void {
	console.info('\n🔄 Syncing @joshuafolkken/config AI files\n')
	console.info('AI files:')

	for (const filename of init_logic.get_ai_copy_files()) {
		sync_file(filename)
	}

	for (const { src, dest } of init_logic.get_ai_copy_file_mappings()) {
		sync_file_mapping(path.join(PACKAGE_DIR, src), path.join(PROJECT_ROOT, dest))
	}

	for (const directory_name of init_logic.get_ai_copy_directories()) {
		sync_directory(directory_name)
	}

	sync_sonar_with_template()

	console.info('\n✅ Done.\n')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const sync = { sync_file_mapping, sync_sonar_file_write }

export { sync }

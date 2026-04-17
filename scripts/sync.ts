#!/usr/bin/env tsx
import { cpSync, mkdirSync } from 'node:fs'
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

function sync_directory(directory_name: string): void {
	cpSync(path.join(PACKAGE_DIR, directory_name), path.join(PROJECT_ROOT, directory_name), {
		recursive: true,
	})
	console.info(`  ✔ synced    ${directory_name}/`)
}

function main(): void {
	console.info('\n🔄 Syncing @joshuafolkken/config AI files\n')
	console.info('AI files:')
	for (const filename of init_logic.get_ai_copy_files()) sync_file(filename)
	for (const directory_name of init_logic.get_ai_copy_directories()) sync_directory(directory_name)
	console.info('\n✅ Done.\n')
}

main()

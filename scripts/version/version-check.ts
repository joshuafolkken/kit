#!/usr/bin/env tsx
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { package_version_schema } from '#scripts/schemas'
import { version_check_logic } from './version-check-logic'
import { fetch_latest_version } from './version-remote'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PKG_PATH = version_check_logic.resolve_package_path(SELF_DIR)

function read_current_version(): string {
	const raw = readFileSync(CONFIG_PKG_PATH, 'utf8')

	return package_version_schema.parse(JSON.parse(raw)).version
}

function main(): void {
	const current = read_current_version()
	const latest = fetch_latest_version()
	const is_local = version_check_logic.is_local_install(process.cwd(), SELF_DIR)

	console.info(version_check_logic.format_version_output(current, latest, is_local))
}

main()

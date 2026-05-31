#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { package_version_schema } from './schemas'
import { version_check_logic } from './version-check-logic'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const CONFIG_PKG_PATH = version_check_logic.resolve_package_path(
	process.cwd(),
	SELF_DIR,
	existsSync,
)
const GH_API_PATH = '/users/joshuafolkken/packages/npm/kit/versions?per_page=1'

function read_current_version(): string {
	const raw = readFileSync(CONFIG_PKG_PATH, 'utf8')

	return package_version_schema.parse(JSON.parse(raw)).version
}

function fetch_latest_version(): string {
	const output = execFileSync('gh', ['api', GH_API_PATH, '--jq', '.[0].name'])

	return output.toString().trim()
}

function main(): void {
	const current = read_current_version()
	const latest = fetch_latest_version()

	console.info(version_check_logic.format_version_output(current, latest))
}

main()

#!/usr/bin/env tsx
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { version_check_logic } from './version-check-logic'

const CONFIG_PKG_PATH = path.join(
	process.cwd(),
	'node_modules',
	'@joshuafolkken',
	'kit',
	'package.json',
)
const GH_API_PATH = '/users/joshuafolkken/packages/npm/kit/versions?per_page=1'

function read_current_version(): string {
	const raw = readFileSync(CONFIG_PKG_PATH, 'utf8')
	const parsed = JSON.parse(raw) as { version: string }

	return parsed.version
}

function fetch_latest_version(): string {
	/* eslint-disable sonarjs/no-os-command-from-path */
	const output = execFileSync('gh', ['api', GH_API_PATH, '--jq', '.[0].name'])
	/* eslint-enable sonarjs/no-os-command-from-path */

	return output.toString().trim()
}

function main(): void {
	const current = read_current_version()
	const latest = fetch_latest_version()

	console.info(version_check_logic.format_version_output(current, latest))
}

main()

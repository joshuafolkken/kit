#!/usr/bin/env tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import { version_check_logic } from './version-check-logic'
import { fetch_latest_version } from './version-remote'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const FAILURE_EXIT_CODE = 1

function run_upgrade(command: string): number {
	const result = execaSync('sh', ['-c', command], { stdio: 'inherit', reject: false })

	return result.exitCode ?? FAILURE_EXIT_CODE
}

function main(): never {
	const is_local = version_check_logic.is_local_install(process.cwd(), SELF_DIR)
	const latest = fetch_latest_version()
	const command = version_check_logic.build_upgrade_shell_command(latest, is_local)

	process.exit(run_upgrade(command))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const version_update = { run_upgrade }

export { version_update }

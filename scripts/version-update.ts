#!/usr/bin/env tsx
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { version_check_logic } from './version-check-logic'
import { fetch_latest_version } from './version-remote'

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url))
const FAILURE_EXIT_CODE = 1

function main(): void {
	const is_local = version_check_logic.is_local_install(process.cwd(), SELF_DIR)
	const latest = fetch_latest_version()
	const command = version_check_logic.build_upgrade_shell_command(latest, is_local)
	const result = spawnSync('sh', ['-c', command], { stdio: 'inherit' })

	process.exit(result.status ?? FAILURE_EXIT_CODE)
}

main()

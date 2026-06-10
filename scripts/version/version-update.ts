#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { execaSync } from 'execa'
import { version_check_logic } from './version-check-logic'
import { fetch_latest_version } from './version-remote'
import { version_targets } from './version-targets'

const FAILURE_EXIT_CODE = 1
const ALREADY_UP_TO_DATE = 'Already up to date'

function run_upgrade(command: string): number {
	const result = execaSync('sh', ['-c', command], { stdio: 'inherit', reject: false })

	return result.exitCode ?? FAILURE_EXIT_CODE
}

// Run every upgrade command in order, returning the last non-zero exit code (or 0 when all
// succeed) so a failure on either target is surfaced without aborting the remaining upgrades.
function run_all_upgrades(commands: ReadonlyArray<string>): number {
	let exit_code = 0

	for (const command of commands) {
		const code = run_upgrade(command)
		if (code !== 0) exit_code = code
	}

	return exit_code
}

function main(): never {
	const latest = fetch_latest_version()
	const global_version = version_targets.read_global_version()
	const project_version = version_targets.read_project_version(process.cwd())
	const commands = version_check_logic.build_dual_upgrade_commands(
		global_version,
		project_version,
		latest,
	)

	if (commands.length === 0) console.info(ALREADY_UP_TO_DATE)

	process.exit(run_all_upgrades(commands))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const version_update = { run_upgrade, run_all_upgrades }

export { version_update }

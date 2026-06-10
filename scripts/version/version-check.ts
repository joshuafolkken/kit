#!/usr/bin/env tsx
import { version_check_logic } from './version-check-logic'
import { fetch_latest_version } from './version-remote'
import { version_targets } from './version-targets'

function main(): void {
	const global_version = version_targets.read_global_version()
	const project_version = version_targets.read_project_version(process.cwd())
	const latest = fetch_latest_version()

	console.info(
		version_check_logic.format_dual_version_output(global_version, project_version, latest),
	)
}

main()

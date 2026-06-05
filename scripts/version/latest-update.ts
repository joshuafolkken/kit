#!/usr/bin/env tsx
/**
 * Filtered `pnpm update --latest` that skips capped-override packages.
 *
 * Usage: tsx scripts/version/latest-update.ts
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { overrides_check } from '#scripts/overrides/overrides-logic'
import { execaSync } from 'execa'
import { preinstall_version_update } from './preinstall-version-update'

const PACKAGE_JSON_PATH = 'package.json'

function run(arguments_: Array<string>): number {
	const [cmd, ...rest] = arguments_
	if (cmd === undefined) return 0
	console.info(`\n▶ ${arguments_.join(' ')}`)
	const result = execaSync(cmd, rest, { stdio: 'inherit', reject: false })

	return result.exitCode ?? 1
}

function run_update(update_arguments: Array<string> | undefined): number {
	if (update_arguments === undefined) {
		console.info('\n⏭ No packages to update.')

		return 0
	}

	return run(update_arguments)
}

function main(): void {
	const package_json_content = readFileSync(PACKAGE_JSON_PATH, 'utf8')
	const overrides = overrides_check.read_overrides_from_package(package_json_content)
	const capped = overrides_check.extract_capped_package_names(overrides)

	if (capped.length > 0) {
		console.info(`\n⏭ Skipping capped-override packages: ${capped.join(', ')}`)
	}

	const update_arguments = overrides_check.build_update_command(overrides, package_json_content)
	const update_status = run_update(update_arguments)

	if (update_status === 0) {
		preinstall_version_update.sync(PACKAGE_JSON_PATH)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const latest_update = { run, main }

export { latest_update }

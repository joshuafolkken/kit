#!/usr/bin/env tsx
/**
 * Filtered `pnpm update --latest` that skips capped-override packages.
 *
 * Usage: tsx scripts/latest-update.ts
 */
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { overrides_check } from './overrides/overrides-logic'

const PACKAGE_JSON_PATH = 'package.json'

function run(command: string): void {
	console.info(`\n▶ ${command}`)
	execSync(command, { stdio: 'inherit' }) // eslint-disable-line sonarjs/os-command
}

const package_json_content = readFileSync(PACKAGE_JSON_PATH, 'utf8')
const overrides = overrides_check.read_overrides_from_package(package_json_content)
const capped = overrides_check.extract_capped_package_names(overrides)

if (capped.length > 0) {
	console.info(`\n⏭ Skipping capped-override packages: ${capped.join(', ')}`)
}

const update_command = overrides_check.build_update_command(overrides, package_json_content)

if (update_command === undefined) {
	console.info('\n⏭ No packages to update.')
} else {
	run(update_command)
}

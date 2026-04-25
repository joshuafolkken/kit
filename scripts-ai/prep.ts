#!/usr/bin/env tsx
/**
 * Pre-implementation preparation: switch to main, pull, update deps, verify overrides.
 *
 * Usage: tsx scripts-ai/prep.ts
 */
import { execSync } from 'node:child_process'
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { git_command } from '../scripts/git/git-command'
import { overrides_check, type OverridesDiff } from '../scripts/overrides/overrides-logic'
import { package_pnpm_schema } from '../scripts/overrides/schemas'
import { json_object_schema } from '../scripts/schemas'

const PACKAGE_JSON_PATH = 'package.json'

function run(command: string): void {
	console.info(`\n▶ ${command}`)
	execSync(command, { stdio: 'inherit' }) // eslint-disable-line sonarjs/os-command
}

function read_package_json(): string {
	return readFileSync(PACKAGE_JSON_PATH, 'utf8')
}

function read_overrides(): Record<string, string> {
	return overrides_check.read_overrides_from_package(read_package_json())
}

function save_snapshot(overrides: Record<string, string>): void {
	writeFileSync(overrides_check.SNAPSHOT_PATH, `${JSON.stringify(overrides, undefined, '\t')}\n`)
}

function restore_overrides(snapshot: Record<string, string>): void {
	const raw = json_object_schema.parse(JSON.parse(read_package_json()))
	const { pnpm } = package_pnpm_schema.parse(raw)

	writeFileSync(
		PACKAGE_JSON_PATH,
		`${JSON.stringify({ ...raw, pnpm: { ...pnpm, overrides: snapshot } }, undefined, '\t')}\n`,
	)
}

function report_diff(diff: OverridesDiff): void {
	console.error('\n⚠ pnpm.overrides was modified by dependency update!')

	for (const entry of diff.removed) {
		console.error(`  - removed: ${entry.key} (was ${entry.value})`)
	}

	for (const entry of diff.modified) {
		console.error(`  ~ changed: ${entry.key}: ${entry.old_value} → ${entry.new_value}`)
	}

	for (const entry of diff.added) {
		console.error(`  + added:   ${entry.key} → ${entry.value}`)
	}
}

function handle_overrides_change(snapshot: Record<string, string>): void {
	restore_overrides(snapshot)
	run('pnpm install')
	console.info('\n✔ Overrides restored from snapshot. Please review before proceeding.')
}

function build_update_argv(overrides: Record<string, string>): Array<string> | undefined {
	const capped = overrides_check.extract_capped_package_names(overrides)

	if (capped.length > 0) {
		console.info(`\n⏭ Skipping capped-override packages: ${capped.join(', ')}`)
	}

	return overrides_check.build_update_command(overrides, read_package_json())
}

async function prepare_repository(): Promise<Record<string, string>> {
	await git_command.checkout('main')
	await git_command.pull()

	const snapshot = read_overrides()

	save_snapshot(snapshot)
	console.info('\n✔ Overrides snapshot saved.')

	return snapshot
}

function update_dependencies(snapshot: Record<string, string>): void {
	run('pnpm latest:corepack')

	const update_argv = build_update_argv(snapshot)

	if (update_argv !== undefined) {
		run(update_argv.join(' '))
	}

	run('pnpm audit')
}

function verify_overrides(snapshot: Record<string, string>): void {
	const diff = overrides_check.compare(snapshot, read_overrides())

	if (diff.is_changed) {
		report_diff(diff)
		handle_overrides_change(snapshot)
	} else {
		console.info('\n✔ pnpm.overrides unchanged. Ready to implement.')
	}
}

async function main(): Promise<void> {
	const snapshot = await prepare_repository()

	update_dependencies(snapshot)
	verify_overrides(snapshot)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

const prep = { report_diff, prepare_repository, restore_overrides }

export { prep }

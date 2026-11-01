#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { find_local_bin_upwards } from '#scripts/build/local-bin'
import { TOOLKIT_BINS, type_check_step } from '#scripts/gate/type-check-step'
import { package_manifest } from '#scripts/lib/package-manifest'
import { execa } from 'execa'
import { z } from 'zod'
import { ui_shot, type ShotCommand, type ToolkitProbe } from './ui-shot'

// `josh ui:shot <route> [route...]` — the I/O around `ui-shot.ts`: probe the project's toolkit bins
// and `package.json` scripts, then run the resolved command with the terminal attached, so its image
// paths and its exit status are the result.

const ARGV_OFFSET = 2
const USAGE = 'Usage: josh ui:shot <route> [route...]'
const FAILURE_EXIT_CODE = 1

const SCRIPTS_MANIFEST_SCHEMA = z.object({ scripts: z.record(z.string(), z.string()).optional() })

function read_scripts(directory: string): ReadonlyArray<string> {
	const manifest = package_manifest.read_manifest_if_valid(directory, SCRIPTS_MANIFEST_SCHEMA)

	return Object.keys(manifest?.scripts ?? {})
}

async function probe_toolkit(
	directory: string,
	bin_name: string,
): Promise<ToolkitProbe | undefined> {
	const bin_path = find_local_bin_upwards(directory, bin_name)
	if (bin_path === undefined) return undefined

	return { path: bin_path, commands: await type_check_step.read_toolkit_commands(bin_path) }
}

async function run_command(command: ShotCommand, directory: string): Promise<number> {
	const result = await execa(command.file, command.args, {
		cwd: directory,
		stdio: 'inherit',
		reject: false,
	})

	return result.exitCode ?? FAILURE_EXIT_CODE
}

async function run(argv: ReadonlyArray<string>, directory: string): Promise<number> {
	if (argv.length === 0) {
		console.error(USAGE)

		return FAILURE_EXIT_CODE
	}

	const resolution = await ui_shot.resolve_shot_command(
		{
			toolkit_bins: TOOLKIT_BINS,
			probe_toolkit: async (bin_name) => await probe_toolkit(directory, bin_name),
			scripts: read_scripts(directory),
		},
		argv,
	)

	if (resolution.kind === 'missing') {
		console.error(ui_shot.describe_missing(resolution.tried))

		return FAILURE_EXIT_CODE
	}

	return await run_command(resolution.command, directory)
}

async function main(argv: ReadonlyArray<string>, directory: string): Promise<void> {
	process.exitCode = await run(argv, directory)
}

const ui_shot_cli = {
	run,
	USAGE,
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	await main(process.argv.slice(ARGV_OFFSET), process.cwd())
}

export { ui_shot_cli }

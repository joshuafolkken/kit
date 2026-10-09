#!/usr/bin/env tsx
import { rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { BUNDLED_COMMAND_DIRECTORY, josh_in_process } from '#scripts/josh/josh-in-process'
import { error_text } from '#scripts/lib/error-message'
import { build } from 'esbuild'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = path.join(PACKAGE_DIR, BUNDLED_COMMAND_DIRECTORY)

// Each `is_bundled` command is pre-built to its own `dist/commands/<script basename>.js`, so a
// consumer's `dist/josh.js` imports it under plain node instead of spawning tsx for its `.ts`
// (`docs/maintainers/runtime-bundling.md`).
//
// **No code splitting, and that is why the import closure is checked.** Every entry is one
// self-contained file, so every module it imports shares the entry's `import.meta.url`; a second
// `process.argv[1] === fileURLToPath(import.meta.url)` guard inside the closure would fire with the
// entry's own. `build-commands.test.ts` refuses a bundled command whose closure carries one.
//
// The bundle sits two levels under the package root, exactly as its source does under `scripts/`,
// so a module that finds the package from its own `import.meta.url` resolves the same directory.
function bundled_scripts(): Array<string> {
	return Object.values(COMMAND_MAP)
		.filter((entry) => entry.is_bundled === true)
		.map((entry) => entry.script ?? '')
}

function entry_point(script: string): { in: string; out: string } {
	const out = path.basename(josh_in_process.bundled_script_path(PACKAGE_DIR, script), '.js')

	return { in: path.join(PACKAGE_DIR, script), out }
}

// Nothing in this checkout launches `dist/commands/` (kit's own `pnpm josh` runs the source), so the
// directory is emptied first rather than pruned after, which drops the output of a command no longer
// bundled.
async function build_commands(out_directory: string = OUT_DIR): Promise<string> {
	rmSync(out_directory, { recursive: true, force: true })
	await build({
		absWorkingDir: PACKAGE_DIR,
		entryPoints: bundled_scripts().map((script) => entry_point(script)),
		outdir: out_directory,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		packages: 'external',
	})

	return out_directory
}

async function main(): Promise<void> {
	try {
		console.info(`  ✔ ${await build_commands()} built`)
	} catch (error) {
		console.error(error_text.message_of(error))
		process.exit(1)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { build_commands, bundled_scripts, OUT_DIR }

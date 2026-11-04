import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { BUNDLED_COMMAND_DIRECTORY, josh_in_process } from '#scripts/josh/josh-in-process'
import { build } from 'esbuild'
import { build_inputs, place_build, source_recorder } from './build-hooks'
import { hook_bundle_stamp } from './hook-bundle-stamp'

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

// Place complete files before the stamp: kit's own dispatcher may launch these during a build.
// Prune removed entries after placement so a launch never finds an emptied directory.
async function build_commands(out_directory: string = OUT_DIR): Promise<string> {
	const sources = build_inputs(fileURLToPath(import.meta.url))
	const entries = bundled_scripts().map((script) => entry_point(script))
	const entry_paths = new Set(entries.map((entry) => entry.in))
	const { outputFiles: files } = await build({
		absWorkingDir: PACKAGE_DIR,
		entryPoints: entries,
		outdir: out_directory,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		packages: 'external',
		write: false,
		plugins: [source_recorder(sources, entry_paths)],
	})
	const stamp = hook_bundle_stamp.stamp_text(
		sources,
		files.map((file) => file.path),
	)

	place_build(out_directory, files, stamp)

	return out_directory
}

export { build_commands, bundled_scripts, OUT_DIR }

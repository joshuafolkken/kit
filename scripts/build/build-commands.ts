import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { BUNDLED_COMMAND_DIRECTORY, josh_in_process } from '#scripts/josh/josh-in-process'
import { build } from 'esbuild'
import { build_inputs, place_build, source_recorder } from './build-hooks'
import { hook_bundle_stamp } from './hook-bundle-stamp'
import { source_location, SOURCE_LOCATION_DEFINE } from './source-location'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = path.join(PACKAGE_DIR, BUNDLED_COMMAND_DIRECTORY)

// Every script command is pre-built to its own `dist/commands/<script basename>.js` in one build, so
// `dist/josh.js` imports it under plain node instead of spawning tsx for its `.ts`
// (`docs/maintainers/runtime-bundling.md`). Code splitting moves what the commands share into
// `chunk-*.js` files beside them, so the common code is built once rather than into every command.
//
// **Each module keeps its source location** (`source-location.ts`): its `import.meta.url` names its
// source file, not the chunk it landed in, so a main guard fires only for the launched script and a
// path worked out from the module's own location resolves as it does from the source.
function bundled_scripts(): Array<string> {
	const scripts = Object.values(COMMAND_MAP).flatMap((entry) => entry.script ?? [])

	return [...new Set(scripts)]
}

function entry_point(script: string): { in: string; out: string } {
	const out = path.basename(josh_in_process.bundled_script_path(PACKAGE_DIR, script), '.js')

	return { in: path.join(PACKAGE_DIR, script), out }
}

// Place complete files before the stamp: kit's own dispatcher may launch these during a build.
// Prune removed entries after placement so a launch never finds an emptied directory.
async function build_commands(out_directory: string = OUT_DIR): Promise<string> {
	const sources = build_inputs(fileURLToPath(import.meta.url))
	const { outputFiles: files } = await build({
		absWorkingDir: PACKAGE_DIR,
		entryPoints: bundled_scripts().map((script) => entry_point(script)),
		outdir: out_directory,
		bundle: true,
		splitting: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		packages: 'external',
		define: SOURCE_LOCATION_DEFINE,
		write: false,
		plugins: [source_recorder(sources, source_location(out_directory))],
	})
	const stamp = hook_bundle_stamp.stamp_text(
		sources,
		files.map((file) => file.path),
	)

	place_build(out_directory, files, stamp)

	return out_directory
}

export { build_commands, bundled_scripts, OUT_DIR }

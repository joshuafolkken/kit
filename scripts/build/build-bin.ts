import { statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomic_write } from '#scripts/lib/atomic-write'
import { build, type OutputFile } from 'esbuild'
import { build_inputs, source_recorder, strip_guards } from './build-hooks'
import { hook_bundle_stamp } from './hook-bundle-stamp'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENTRY_POINT = path.join(PACKAGE_DIR, 'scripts', 'josh', 'josh.ts')
const ENTRY_POINTS: ReadonlySet<string> = new Set([ENTRY_POINT])
const OUTFILE = path.join(PACKAGE_DIR, 'dist', 'josh.js')
const NODE_BANNER = '#!/usr/bin/env node'
const BIN_MODE = 0o755

function place_output(file: OutputFile): void {
	const mode = statSync(file.path, { throwIfNoEntry: false })?.mode ?? BIN_MODE

	atomic_write.replace_file(file.path, file.contents, { mode })
}

async function build_bin(outfile: string = OUTFILE): Promise<void> {
	const sources = build_inputs(fileURLToPath(import.meta.url))
	const { outputFiles: files } = await build({
		entryPoints: [ENTRY_POINT],
		outfile,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		packages: 'external',
		banner: { js: NODE_BANNER },
		write: false,
		plugins: [source_recorder(sources, strip_guards(ENTRY_POINTS))],
	})
	for (const file of files) place_output(file)
	atomic_write.replace_file(
		path.join(path.dirname(outfile), hook_bundle_stamp.STAMP_NAME),
		hook_bundle_stamp.stamp_text(
			sources,
			files.map((file) => file.path),
		),
	)
}

export { build_bin, NODE_BANNER, OUTFILE }

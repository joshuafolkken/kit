import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const ENTRY_POINT = path.join(PACKAGE_DIR, 'scripts', 'josh', 'josh.ts')
const OUTFILE = path.join(PACKAGE_DIR, 'dist', 'josh.js')
const NODE_BANNER = '#!/usr/bin/env node'

async function build_bin(outfile: string = OUTFILE): Promise<void> {
	await build({
		entryPoints: [ENTRY_POINT],
		outfile,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		packages: 'external',
		banner: { js: NODE_BANNER },
	})
}

export { build_bin, NODE_BANNER, OUTFILE }

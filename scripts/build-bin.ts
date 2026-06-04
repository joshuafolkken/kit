#!/usr/bin/env tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY_POINT = path.join(PACKAGE_DIR, 'scripts', 'josh', 'josh.ts')
const OUTFILE = path.join(PACKAGE_DIR, 'dist', 'josh.js')
const NODE_BANNER = '#!/usr/bin/env node'

async function build_bin(): Promise<void> {
	await build({
		entryPoints: [ENTRY_POINT],
		outfile: OUTFILE,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		packages: 'external',
		banner: { js: NODE_BANNER },
	})
}

async function main(): Promise<void> {
	try {
		await build_bin()
		console.info(`  ✔ ${OUTFILE} built`)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { build_bin, NODE_BANNER, OUTFILE }

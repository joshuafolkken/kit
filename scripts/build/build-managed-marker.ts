#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { build_library, library_paths } from './build-library'

const MANAGED_MARKER_LIBRARY = 'managed-marker'
const { outfile: MANAGED_MARKER_OUTFILE, dts_file: MANAGED_MARKER_DTS_FILE } =
	library_paths(MANAGED_MARKER_LIBRARY)

async function build_managed_marker_library(): Promise<void> {
	await build_library(MANAGED_MARKER_LIBRARY)
}

async function main(): Promise<void> {
	try {
		await build_managed_marker_library()
		console.info(`  ✔ ${MANAGED_MARKER_OUTFILE} built`)
		console.info(`  ✔ ${MANAGED_MARKER_DTS_FILE} built`)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { build_managed_marker_library, MANAGED_MARKER_OUTFILE, MANAGED_MARKER_DTS_FILE }

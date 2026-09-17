#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { build_library, library_paths } from './build-library'

const SELF_SYNC_GUARD_LIBRARY = 'self-sync-guard'
const { outfile: SELF_SYNC_GUARD_OUTFILE, dts_file: SELF_SYNC_GUARD_DTS_FILE } =
	library_paths(SELF_SYNC_GUARD_LIBRARY)

async function build_self_sync_guard_library(): Promise<void> {
	await build_library(SELF_SYNC_GUARD_LIBRARY)
}

async function main(): Promise<void> {
	try {
		await build_self_sync_guard_library()
		console.info(`  ✔ ${SELF_SYNC_GUARD_OUTFILE} built`)
		console.info(`  ✔ ${SELF_SYNC_GUARD_DTS_FILE} built`)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { build_self_sync_guard_library, SELF_SYNC_GUARD_OUTFILE, SELF_SYNC_GUARD_DTS_FILE }

#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { build_library, library_paths } from './build-library'

const CONFIG_MERGE_LIBRARY = 'config-merge'
const { outfile: CONFIG_MERGE_OUTFILE, dts_file: CONFIG_MERGE_DTS_FILE } =
	library_paths(CONFIG_MERGE_LIBRARY)

async function build_config_merge_library(): Promise<void> {
	await build_library(CONFIG_MERGE_LIBRARY)
}

async function main(): Promise<void> {
	try {
		await build_config_merge_library()
		console.info(`  ✔ ${CONFIG_MERGE_OUTFILE} built`)
		console.info(`  ✔ ${CONFIG_MERGE_DTS_FILE} built`)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { build_config_merge_library, CONFIG_MERGE_OUTFILE, CONFIG_MERGE_DTS_FILE }

#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { build_library, library_paths } from './build-library'

const VERSION_LIBRARY = 'version'
const { outfile: VERSION_OUTFILE, dts_file: VERSION_DTS_FILE } = library_paths(VERSION_LIBRARY)

async function build_version_library(): Promise<void> {
	await build_library(VERSION_LIBRARY)
}

async function main(): Promise<void> {
	try {
		await build_version_library()
		console.info(`  ✔ ${VERSION_OUTFILE} built`)
		console.info(`  ✔ ${VERSION_DTS_FILE} built`)
	} catch (error) {
		console.error(error instanceof Error ? error.message : String(error))
		process.exit(1)
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

export { build_version_library, VERSION_OUTFILE, VERSION_DTS_FILE }

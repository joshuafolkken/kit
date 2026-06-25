#!/usr/bin/env tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { rollup, type Plugin } from 'rollup'
import { dts } from 'rollup-plugin-dts'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const ENTRY_POINT = path.join(PACKAGE_DIR, 'scripts', 'version', 'index.ts')
const OUTPUT_DIR = path.join(PACKAGE_DIR, 'dist', 'version')
const VERSION_OUTFILE = path.join(OUTPUT_DIR, 'index.js')
const VERSION_DTS_FILE = path.join(OUTPUT_DIR, 'index.d.ts')

const SCRIPTS_IMPORT_PREFIX = '#scripts/'

// Bundle the `./version` library to a single runtime `.js`. `packages: 'external'` keeps bare
// dependencies (execa, zod, …) as runtime imports the consumer resolves from kit's own
// node_modules, while kit's internal `#scripts/*` graph is inlined — so a consumer can keep
// `@joshuafolkken/kit/version` external and avoid bundling kit's whole transitive graph.
async function build_version_js(): Promise<void> {
	await build({
		entryPoints: [ENTRY_POINT],
		outfile: VERSION_OUTFILE,
		bundle: true,
		platform: 'node',
		format: 'esm',
		target: 'node22',
		packages: 'external',
	})
}

// rollup resolves bare specifiers and relative paths, but not kit's `#scripts/*` subpath imports
// (declared in package.json `imports`). Map them to absolute source so rollup-plugin-dts follows
// and inlines their types instead of leaving an unresolvable `#scripts/*` import in the output.
function resolve_scripts_imports(): Plugin {
	return {
		name: 'resolve-scripts-imports',
		resolveId(source: string): string | undefined {
			if (!source.startsWith(SCRIPTS_IMPORT_PREFIX)) return undefined
			const relative = source.slice(SCRIPTS_IMPORT_PREFIX.length)

			return path.join(PACKAGE_DIR, 'scripts', `${relative}.ts`)
		},
	}
}

// Emit a single self-contained `index.d.ts` with no `#scripts/*` references, so a NodeNext
// consumer type-checks against the compiled output without bundling or extensionless-import errors.
async function build_version_dts(): Promise<void> {
	const bundle = await rollup({
		input: ENTRY_POINT,
		plugins: [resolve_scripts_imports(), dts()],
	})

	await bundle.write({ file: VERSION_DTS_FILE, format: 'es' })
	await bundle.close()
}

async function build_version_library(): Promise<void> {
	await build_version_js()
	await build_version_dts()
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

#!/usr/bin/env tsx
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'
import { rollup, type Plugin } from 'rollup'
import { dts } from 'rollup-plugin-dts'

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const SCRIPTS_IMPORT_PREFIX = '#scripts/'

interface LibraryPaths {
	entry_point: string
	outfile: string
	dts_file: string
}

// Resolve the source entry and compiled outputs for a public library named `<name>`: source at
// `scripts/<name>/index.ts`, bundled to `dist/<name>/index.{js,d.ts}` (mirrors the `./<name>`
// package.json export). Shared by every per-library build script so the layout is single-sourced.
function library_paths(name: string): LibraryPaths {
	const output_directory = path.join(PACKAGE_DIR, 'dist', name)

	return {
		entry_point: path.join(PACKAGE_DIR, 'scripts', name, 'index.ts'),
		outfile: path.join(output_directory, 'index.js'),
		dts_file: path.join(output_directory, 'index.d.ts'),
	}
}

// Bundle a library to a single runtime `.js`. `packages: 'external'` keeps bare dependencies
// (js-yaml, execa, zod, …) as runtime imports the consumer resolves from kit's own node_modules,
// while kit's internal `#scripts/*` graph is inlined — so a consumer can keep the library external
// and avoid bundling kit's whole transitive graph.
async function build_library_js(entry_point: string, outfile: string): Promise<void> {
	await build({
		entryPoints: [entry_point],
		outfile,
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
async function build_library_dts(entry_point: string, dts_file: string): Promise<void> {
	const bundle = await rollup({
		input: entry_point,
		plugins: [resolve_scripts_imports(), dts()],
	})

	await bundle.write({ file: dts_file, format: 'es' })
	await bundle.close()
}

async function build_library(name: string): Promise<LibraryPaths> {
	const paths = library_paths(name)

	await build_library_js(paths.entry_point, paths.outfile)
	await build_library_dts(paths.entry_point, paths.dts_file)

	return paths
}

export type { LibraryPaths }
export { build_library, library_paths }

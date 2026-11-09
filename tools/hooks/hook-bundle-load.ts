import { realpathSync } from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

// Runs one hook bundle in the launching process: `process.argv` is set to what
// `node dist/hooks/<name>.js [arguments...]` would have given it, because every hook runs its main
// from `process.argv[1] === fileURLToPath(import.meta.url)`. Shared by the source gate
// (`hook-bundle-ready.ts`) and its built fast path (`hook-bundle-fast.ts`).

const MODULE_NOT_FOUND = 'ERR_MODULE_NOT_FOUND'
const RELOAD_QUERY = 'reload'

type BundleLoad = (href: string) => Promise<unknown>

async function load_module(href: string): Promise<unknown> {
	return await import(href)
}

// A file of the bundle's own directory missing at load: the background build pruned the chunks of the
// stale build this launch was still linking.
function is_pruned_chunk(error: unknown, bundle_path: string): boolean {
	if (!(error instanceof Error) || Reflect.get(error, 'code') !== MODULE_NOT_FOUND) return false

	return error.message.includes(path.dirname(bundle_path))
}

// A link error evaluates nothing, so the load is retried once — under a fresh URL, past the failed one
// Node remembers — and reads the build that pruned it, whose entry was placed before the prune.
// `fileURLToPath` drops the query, so the bundle's self-invoke still matches `argv[1]`.
async function import_bundle(bundle_path: string, load: BundleLoad = load_module): Promise<void> {
	const { href } = pathToFileURL(bundle_path)

	try {
		await load(href)
	} catch (error) {
		if (!is_pruned_chunk(error, bundle_path)) throw error
		await load(`${href}?${RELOAD_QUERY}`)
	}
}

// The real path, because Node resolves an imported module's `import.meta.url` through symlinks.
async function run_bundle(bundle: string, hook_arguments: ReadonlyArray<string>): Promise<void> {
	const bundle_path = realpathSync(bundle)

	process.argv.splice(1, process.argv.length, bundle_path, ...hook_arguments)
	await import_bundle(bundle_path)
}

const hook_bundle_load = { import_bundle, run_bundle }

export { hook_bundle_load }

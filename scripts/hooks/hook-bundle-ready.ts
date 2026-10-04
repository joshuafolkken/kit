import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { error_text } from '#scripts/lib/error-message'

// The gate each of kit's own hook commands passes before it launches `node dist/hooks/<name>.js`
// (`scripts/init/hook-launch.ts`, joshuafolkken/kit#2984). Exit 0 means the bundles match the source
// beside them — already, or after rebuilding them here — and the command runs the bundle; a non-zero
// exit sends the command to its `pnpm josh` fallback, which runs the live source.
//
// **Stale bundles are rebuilt rather than skipped.** The fallback pays a pnpm launch and a cold tsx
// compile of the whole hook graph, and a hook that outruns its timeout fails open — every guard off,
// with nothing said. A rebuild takes a fraction of a second, so the slow path is left only for a
// checkout that cannot build at all (no installed dependencies, or a source that does not compile),
// and that case is announced on stderr instead of passing silently.
//
// Run by plain `node` (type stripping), so every import resolves without `tsx`: `node:` built-ins and
// `#scripts/*` subpaths only. The build is imported on the stale path alone — esbuild is the one
// expensive load, and a fresh launch never pays it. Nothing is written to stdout and stdin is never
// read: both belong to the hook the command launches next.

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = path.join(PACKAGE_DIR, 'dist', 'hooks')
const REBUILT_NOTICE = 'kit hooks: dist/hooks was stale against the source and has been rebuilt'
const FAILED_NOTICE =
	'kit hooks: dist/hooks is stale and could not be rebuilt, so this hook runs from source through pnpm — slow, and a hook that exceeds its timeout lets the call through unguarded. Fix the build (pnpm build) to restore the bundles'

type Rebuild = (out_directory: string) => Promise<void>

async function rebuild_from_source(out_directory: string): Promise<void> {
	const { build_hooks } = await import('#scripts/build/build-hooks')

	await build_hooks(out_directory)
}

// True when the bundles in `out_directory` can be launched as the current source.
async function ensure_bundles(
	out_directory: string = OUT_DIR,
	rebuild: Rebuild = rebuild_from_source,
): Promise<boolean> {
	if (hook_bundle_stamp.is_fresh(out_directory, PACKAGE_DIR)) return true

	try {
		await rebuild(out_directory)
		console.error(REBUILT_NOTICE)

		return true
	} catch (error) {
		console.error(`${FAILED_NOTICE} (${error_text.message_of(error)})`)

		return false
	}
}

async function main(): Promise<void> {
	process.exitCode = (await ensure_bundles()) ? 0 : 1
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

const hook_bundle_ready = { ensure_bundles, FAILED_NOTICE, REBUILT_NOTICE }

export { hook_bundle_ready }

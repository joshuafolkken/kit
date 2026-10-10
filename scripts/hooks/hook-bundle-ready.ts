import { spawnSync } from 'node:child_process'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { error_text } from '#scripts/lib/error-message'

// The launch of each of kit's own hook commands in kit's checkout (`scripts/hooks/run-hook.sh`):
//`node hook-bundle-ready.ts <name> <josh command> [arguments...]` checks
// that the bundles match the source beside them — already, or after rebuilding them here — and runs
// `dist/hooks/<name>.js` in this same process; a checkout that cannot build runs its `pnpm josh`
// fallback, which runs the live source.
//
// **One node launch per hook call**. The gate and the bundle used to be two
// `node` processes, so every tool call paid the node start-up twice. The bundle is imported here
// instead, with `process.argv` set to what `node dist/hooks/<name>.js [arguments...]` would have given
// it, because every hook runs its main from `process.argv[1] === fileURLToPath(import.meta.url)`.
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
// read: both belong to the hook.

const PACKAGE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = path.join(PACKAGE_DIR, 'dist', 'hooks')
const FALLBACK_FAILED_EXIT = 1
// `process.argv` is node, this script, then the hook name, its josh command and its arguments.
const LAUNCH_ARGUMENTS_START = 2
const REBUILT_NOTICE = 'kit hooks: dist/hooks was stale against the source and has been rebuilt'
const FAILED_NOTICE =
	'kit hooks: dist/hooks is stale and could not be rebuilt, so this hook runs from source through pnpm — slow, and a hook that exceeds its timeout lets the call through unguarded. Fix the build (pnpm build) to restore the bundles'

type Rebuild = (out_directory: string) => Promise<void>

interface HookLaunch {
	hook_name: string
	josh_command: string
	hook_arguments: ReadonlyArray<string>
}

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

// The real path, because Node resolves an imported module's `import.meta.url` through symlinks.
async function run_bundle(bundle: string, hook_arguments: ReadonlyArray<string>): Promise<void> {
	const bundle_path = realpathSync(bundle)

	process.argv.splice(1, process.argv.length, bundle_path, ...hook_arguments)
	await import(pathToFileURL(bundle_path).href)
}

function run_from_source(josh_command: string, hook_arguments: ReadonlyArray<string>): void {
	const { status } = spawnSync('pnpm', ['josh', josh_command, ...hook_arguments], {
		stdio: 'inherit',
	})

	process.exitCode = status ?? FALLBACK_FAILED_EXIT
}

async function launch(
	request: HookLaunch,
	out_directory: string = OUT_DIR,
	rebuild: Rebuild = rebuild_from_source,
): Promise<void> {
	if (!(await ensure_bundles(out_directory, rebuild))) {
		run_from_source(request.josh_command, request.hook_arguments)

		return
	}

	await run_bundle(path.join(out_directory, `${request.hook_name}.js`), request.hook_arguments)
}

async function main(): Promise<void> {
	const [hook_name = '', josh_command = '', ...hook_arguments] =
		process.argv.slice(LAUNCH_ARGUMENTS_START)

	await launch({ hook_name, josh_command, hook_arguments })
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()

const hook_bundle_ready = { ensure_bundles, FAILED_NOTICE, launch, REBUILT_NOTICE }

export type { HookLaunch }
export { hook_bundle_ready }

import { spawn, spawnSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { error_text } from '#scripts/lib/error-message'

// The launch of each of kit's own hook commands in kit's checkout (`scripts/hooks/run-hook.sh`):
//`node hook-bundle-ready.ts <name> <josh command> [arguments...]` checks
// that the bundles match the source beside them and runs `dist/hooks/<name>.js` in this same process;
// a checkout that has no bundle to run and cannot build one runs its `pnpm josh` fallback, which runs
// the live source.
//
// One node launch per hook call avoids paying startup twice. The bundle is imported here
// with `process.argv` set to what `node dist/hooks/<name>.js [arguments...]` would have given
// it, because every hook runs its main from `process.argv[1] === fileURLToPath(import.meta.url)`.
//
// **Stale bundles are rebuilt out of the hook call (joshuafolkken/kit#5628).** Every source edit makes
// the bundles stale, and the next hook call — the edit's own `format-edited` — would otherwise wait on
// esbuild. A stale build that is still whole runs as it is while a detached `node hook-bundle-ready.ts
// --rebuild <out directory>` rebuilds it, and the call after that build lands runs the new bundles.
// The window is the build's own fraction of a second, and what runs in it is the last build, which
// guarded every call before the edit; a guard edit takes effect one call later than the edit, and the
// rebuild is announced on stderr. A lock beside the bundles keeps the launches that find them stale
// at once to one build. Two builds side by side — a lock taken over in the same instant — are safe:
// each places its files through its own staging directory (`build-hooks.ts`).
//
// **With nothing whole to run, the rebuild stays in the call.** The fallback pays a pnpm launch and a
// cold tsx compile of the whole hook graph, and a hook that outruns its timeout fails open — every
// guard off, with nothing said. So the slow path is left only for a checkout that cannot build at all
// (no installed dependencies, or a source that does not compile), and that case is announced on stderr.
//
// Run by plain `node` (type stripping), so every import resolves without `tsx`: `node:` built-ins and
// `#scripts/*` subpaths only. The build is imported on the rebuild path alone — esbuild is the one
// expensive load, and a launch never pays it. Nothing is written to stdout and stdin is never
// read: both belong to the hook.

const LAUNCH_SCRIPT = fileURLToPath(import.meta.url)
const PACKAGE_DIR = path.join(path.dirname(LAUNCH_SCRIPT), '..', '..')
const OUT_DIR = path.join(PACKAGE_DIR, 'dist', 'hooks')
const TSX_BIN = path.join(PACKAGE_DIR, 'node_modules', '.bin', 'tsx')
const JOSH_ENTRY = path.join(PACKAGE_DIR, 'scripts', 'josh', 'josh.ts')
const FALLBACK_FAILED_EXIT = 1
// `process.argv` is node, this script, then the hook name, its josh command and its arguments.
const LAUNCH_ARGUMENTS_START = 2
const REBUILD_FLAG = '--rebuild'
// A rebuild takes well under a second, so a lock this old was left by a build that died.
const ABANDONED_LOCK_MS = 60_000
const REBUILT_NOTICE = 'kit hooks: dist/hooks was stale against the source and has been rebuilt'
const STALE_NOTICE =
	'kit hooks: dist/hooks is stale against the source, so this call runs the previous build while it is rebuilt in the background'
const FAILING_NOTICE =
	'kit hooks: dist/hooks is stale and its last background rebuild failed, so this call runs the previous build — an edited guard does not take effect until the source builds again (pnpm build shows the error)'
const MODULE_NOT_FOUND = 'ERR_MODULE_NOT_FOUND'
const RELOAD_QUERY = 'reload'
const FAILED_NOTICE =
	'kit hooks: dist/hooks is stale and could not be rebuilt, so this hook runs from source through pnpm — slow, and a hook that exceeds its timeout lets the call through unguarded. Fix the build (pnpm build) to restore the bundles'

type Rebuild = (out_directory: string) => Promise<void>
type StartRebuild = (out_directory: string) => void
type BundleLoad = (href: string) => Promise<unknown>

interface BundleBuilds {
	rebuild: Rebuild
	start_rebuild: StartRebuild
}

interface HookLaunch {
	hook_name: string
	josh_command: string
	hook_arguments: ReadonlyArray<string>
}

async function load_module(href: string): Promise<unknown> {
	return await import(href)
}

async function rebuild_from_source(out_directory: string): Promise<void> {
	const { build_hooks } = await import('#scripts/build/build-hooks')

	await build_hooks(out_directory)
}

// Beside the bundles, not among them: a build prunes every file in its directory it did not emit.
function beside_bundles(out_directory: string, suffix: string): string {
	return path.join(path.dirname(out_directory), `.${path.basename(out_directory)}-${suffix}`)
}

function rebuild_lock(out_directory: string): string {
	return beside_bundles(out_directory, 'rebuild.lock')
}

// Written by a background build that failed and removed by one that succeeds, so a source esbuild
// rejects is reported on every call instead of passing as a rebuild in progress.
function rebuild_failure(out_directory: string): string {
	return beside_bundles(out_directory, 'rebuild.failed')
}

function is_lock_free(lock: string): boolean {
	const stats = statSync(lock, { throwIfNoEntry: false })

	return stats === undefined || Date.now() - stats.mtimeMs > ABANDONED_LOCK_MS
}

// An exclusive create, so of the launches that find the bundles stale at once only one starts a build.
function claim_rebuild(lock: string): boolean {
	if (!is_lock_free(lock)) return false
	rmSync(lock, { force: true })

	try {
		writeFileSync(lock, '', { flag: 'wx' })

		return true
	} catch {
		return false
	}
}

function start_background_rebuild(out_directory: string): void {
	const lock = rebuild_lock(out_directory)
	if (!claim_rebuild(lock)) return
	const child = spawn(
		process.execPath,
		[...process.execArgv, LAUNCH_SCRIPT, REBUILD_FLAG, out_directory],
		{ detached: true, stdio: 'ignore' },
	)

	child.on('error', () => {
		rmSync(lock, { force: true })
	})
	child.unref()
}

// The detached build's own run. A failed build records why and releases the lock too, so the next
// launch reports it and tries again — the edit that fixes the source is picked up at once.
async function rebuild_detached(
	out_directory: string,
	rebuild: Rebuild = rebuild_from_source,
): Promise<void> {
	try {
		await rebuild(out_directory)
		rmSync(rebuild_failure(out_directory), { force: true })
	} catch (error) {
		writeFileSync(rebuild_failure(out_directory), error_text.message_of(error))
		throw error
	} finally {
		rmSync(rebuild_lock(out_directory), { force: true })
	}
}

function announce_stale(out_directory: string): void {
	const failure = rebuild_failure(out_directory)

	console.error(
		existsSync(failure) ? `${FAILING_NOTICE} (${readFileSync(failure, 'utf8')})` : STALE_NOTICE,
	)
}

async function rebuild_now(out_directory: string, rebuild: Rebuild): Promise<boolean> {
	try {
		await rebuild(out_directory)
		console.error(REBUILT_NOTICE)

		return true
	} catch (error) {
		console.error(`${FAILED_NOTICE} (${error_text.message_of(error)})`)

		return false
	}
}

const DEFAULT_BUILDS: BundleBuilds = {
	rebuild: rebuild_from_source,
	start_rebuild: start_background_rebuild,
}

// True when `bundle` can be launched now: fresh, stale but whole (rebuilt in the background), or
// rebuilt here because there was nothing whole to run.
async function ensure_bundle(
	bundle: string,
	builds: BundleBuilds = DEFAULT_BUILDS,
): Promise<boolean> {
	const out_directory = path.dirname(bundle)
	if (hook_bundle_stamp.is_fresh(out_directory, PACKAGE_DIR)) return true

	if (!hook_bundle_stamp.has_outputs(out_directory) || !existsSync(bundle)) {
		return await rebuild_now(out_directory, builds.rebuild)
	}

	announce_stale(out_directory)
	builds.start_rebuild(out_directory)

	return true
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

// This checkout's own `tsx` and josh entry, run in the hook's working directory: a hook launched in
// one of Claude Code's own worktrees runs there, and that worktree has no install for `pnpm josh` —
// while `pnpm --dir` would move the hook back to the main checkout (joshuafolkken/kit#4617).
function run_from_source(josh_command: string, hook_arguments: ReadonlyArray<string>): void {
	const { status } = spawnSync(TSX_BIN, [JOSH_ENTRY, josh_command, ...hook_arguments], {
		stdio: 'inherit',
	})

	process.exitCode = status ?? FALLBACK_FAILED_EXIT
}

async function launch(
	request: HookLaunch,
	out_directory: string = OUT_DIR,
	builds: BundleBuilds = DEFAULT_BUILDS,
): Promise<void> {
	const bundle = path.join(out_directory, `${request.hook_name}.js`)

	if (!(await ensure_bundle(bundle, builds))) {
		run_from_source(request.josh_command, request.hook_arguments)

		return
	}

	await run_bundle(bundle, request.hook_arguments)
}

async function main(): Promise<void> {
	const [first = '', second = '', ...rest] = process.argv.slice(LAUNCH_ARGUMENTS_START)

	if (first === REBUILD_FLAG) {
		if (second !== '') await rebuild_detached(second)

		return
	}

	await launch({ hook_name: first, josh_command: second, hook_arguments: rest })
}

if (process.argv[1] === LAUNCH_SCRIPT) await main()

const hook_bundle_ready = {
	ensure_bundle,
	FAILED_NOTICE,
	FAILING_NOTICE,
	import_bundle,
	launch,
	REBUILD_FLAG,
	rebuild_detached,
	rebuild_failure,
	rebuild_lock,
	REBUILT_NOTICE,
	STALE_NOTICE,
	start_background_rebuild,
}

export type { BundleBuilds, HookLaunch }
export { hook_bundle_ready }

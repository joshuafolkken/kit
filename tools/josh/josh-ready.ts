import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { bundle_rebuild_lock } from '#tools/hooks/bundle-rebuild-lock'

// kit's own `pnpm josh` (joshuafolkken/kit#6769): plain node shares the hook's freshness check and runs
// the built dispatcher, so a fresh `dist` loads no TS loader. A stale `dist` — every source edit makes
// one — is rebuilt here first, the way `pnpm build` builds it, and the new bundle runs: compiling the
// whole graph through tsx on every call is the heaviest launch, and a stale bundle would run code the
// edit already replaced. A lock beside `dist/commands` keeps concurrent launches to one build; the
// others wait for it. Only a build that fails, or a source edited while it ran, runs the source under tsx.
const LAUNCH_SCRIPT = fileURLToPath(import.meta.url)
const PACKAGE_DIR = path.resolve(path.dirname(LAUNCH_SCRIPT), '..', '..')
const ARGUMENTS_START = 2
const LOCK_POLL_MS = 100
// The build's progress lines go to stderr: stdout belongs to the josh command.
const STDERR_FD = 2
const FAILED_NOTICE =
	'josh: dist is stale and could not be rebuilt, so this command runs from source through tsx (pnpm build shows the error)'

// Throws when the build fails.
type Rebuild = (package_directory: string) => void

function is_fresh(package_directory: string): boolean {
	const distribution = path.join(package_directory, 'dist')

	return [distribution, path.join(distribution, 'commands')].every((directory) =>
		hook_bundle_stamp.is_fresh(directory, package_directory),
	)
}

function rebuild_from_source(package_directory: string): void {
	const tsx = path.join(package_directory, 'node_modules', '.bin', 'tsx')
	const { status } = spawnSync(tsx, [path.join(package_directory, 'scripts/build/build.ts')], {
		cwd: package_directory,
		stdio: ['ignore', STDERR_FD, 'inherit'],
	})
	if (status !== 0) throw new Error(`build exited with ${String(status)}`)
}

// True when this launch rebuilt `dist`, or waited out another launch's build that left it fresh.
async function rebuild_once(package_directory: string, rebuild: Rebuild): Promise<boolean> {
	const lock = bundle_rebuild_lock.lock_path(path.join(package_directory, 'dist', 'commands'))

	mkdirSync(path.dirname(lock), { recursive: true })

	if (!bundle_rebuild_lock.claim(lock)) {
		await sleep(LOCK_POLL_MS)

		return is_fresh(package_directory) || (await rebuild_once(package_directory, rebuild))
	}

	try {
		rebuild(package_directory)

		return true
	} catch {
		return false
	} finally {
		bundle_rebuild_lock.release(lock)
	}
}

async function launch_target(
	package_directory: string,
	rebuild: Rebuild = rebuild_from_source,
): Promise<string> {
	const bundle = path.join(package_directory, 'dist', 'josh.js')
	if (is_fresh(package_directory)) return bundle
	if ((await rebuild_once(package_directory, rebuild)) && is_fresh(package_directory)) return bundle
	console.error(FAILED_NOTICE)

	return path.join(package_directory, 'scripts/josh/josh.ts')
}

async function launch(
	package_directory: string = PACKAGE_DIR,
	rebuild: Rebuild = rebuild_from_source,
): Promise<void> {
	const target = await launch_target(package_directory, rebuild)

	if (target.endsWith('.ts')) {
		const { register } = await import('tsx/esm/api')

		register()
	}

	process.argv = [process.execPath, target, ...process.argv.slice(ARGUMENTS_START)]
	await import(pathToFileURL(target).href)
}

if (process.argv[1] === LAUNCH_SCRIPT) await launch()

export type { Rebuild }
export { FAILED_NOTICE, launch, launch_target }

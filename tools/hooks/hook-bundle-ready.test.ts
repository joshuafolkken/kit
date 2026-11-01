import { ChildProcess, spawn, spawnSync, type SpawnSyncReturns } from 'node:child_process'
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	realpathSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build_hooks } from '#scripts/build/build-hooks'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import {
	hook_bundle_ready,
	type BundleBuilds,
	type HookLaunch,
} from '#tools/hooks/hook-bundle-ready'
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	onTestFinished,
	vi,
	type Mock,
	type MockInstance,
} from 'vitest'

vi.mock(import('node:child_process'), async (import_original) => ({
	...(await import_original()),
	spawn: vi.fn(),
	spawnSync: vi.fn(),
}))

const {
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
} = hook_bundle_ready

const BUILD_TIMEOUT_MS = 60_000
const BUILD_ERROR = 'Transform failed'
const REFUSED = 2
const PACKAGE_ROOT = path.join(import.meta.dirname, '..', '..')
const { STAMP_NAME } = hook_bundle_stamp
// Older than any rebuild could take, so a lock stamped with it reads as left by a dead build.
const ABANDONED_TIME = new Date('2026-01-01T00:00:00Z')
const PROBE_KEY = 'hook_bundle_ready_probe'
const PROBE_HOOK = 'probe-hook'
const PROBE_COMMAND = 'probe:hook'
const LATE_CHUNK = 'chunk-late.js'
// A hook bundle in miniature: it runs its main only when launched as `argv[1]`, as every hook does.
const PROBE_BUNDLE = [
	"import { fileURLToPath } from 'node:url'",
	`if (process.argv[1] === fileURLToPath(import.meta.url)) globalThis.${PROBE_KEY} = process.argv.slice(2)`,
].join('\n')

function write_probe_bundle(out_directory: string): void {
	writeFileSync(path.join(out_directory, `${PROBE_HOOK}.js`), PROBE_BUNDLE)
}

function probe_launch(): HookLaunch {
	return {
		hook_name: PROBE_HOOK,
		josh_command: PROBE_COMMAND,
		hook_arguments: ['first', 'second'],
	}
}

function spawn_result(status: number): SpawnSyncReturns<string> {
	// eslint-disable-next-line unicorn/no-null -- spawnSync reports an exit with no signal as null
	return { pid: 0, output: [], stdout: '', stderr: '', status, signal: null }
}

// Inside a directory of its own, so the lock and the failure record a build leaves beside the bundles
// are removed with it.
function create_out_directory(): string {
	const parent = mkdtempSync(path.join(tmpdir(), 'hook-bundle-ready-'))
	const out_directory = path.join(parent, 'hooks')

	onTestFinished(() => {
		rmSync(parent, { recursive: true, force: true })
	})
	mkdirSync(out_directory)

	return out_directory
}

function silence_stderr(): MockInstance<typeof console.error> {
	return vi.spyOn(console, 'error').mockReturnValue(undefined)
}

function recording_rebuild(): Mock<(out_directory: string) => Promise<void>> {
	return vi.fn<(out_directory: string) => Promise<void>>().mockResolvedValue(undefined)
}

async function failing_rebuild(): Promise<void> {
	throw new Error(BUILD_ERROR)
}

function builds_of(rebuild: BundleBuilds['rebuild']): BundleBuilds {
	return { rebuild, start_rebuild: vi.fn() }
}

// A finished build whose record no longer matches the source: it lists no toolchain input.
function write_stale_build(out_directory: string): void {
	write_probe_bundle(out_directory)
	writeFileSync(
		path.join(out_directory, STAMP_NAME),
		hook_bundle_stamp.stamp_text(new Map(), [`${PROBE_HOOK}.js`]),
	)
}

function probe_bundle(out_directory: string): string {
	return path.join(out_directory, `${PROBE_HOOK}.js`)
}

// A child that was never started: it takes listeners and an unref like the detached build would.
function detached_child(): ChildProcess {
	return new ChildProcess()
}

const saved = { argv: [...process.argv] }

beforeEach(() => {
	saved.argv = [...process.argv]
})

afterEach(() => {
	vi.restoreAllMocks()
	process.argv.splice(0, process.argv.length, ...saved.argv)
	process.exitCode = undefined
	Reflect.deleteProperty(globalThis, PROBE_KEY)
})

describe('ensure_bundle', () => {
	it('rebuilds in the call when there is no build to run, and says so', async () => {
		const out_directory = create_out_directory()
		const error = silence_stderr()
		const builds = builds_of(recording_rebuild())

		expect(await ensure_bundle(probe_bundle(out_directory), builds)).toBe(true)
		expect(builds.rebuild).toHaveBeenCalledWith(out_directory)
		expect(builds.start_rebuild).not.toHaveBeenCalled()
		expect(error).toHaveBeenCalledWith(REBUILT_NOTICE)
	})

	it('runs a stale build that is still whole and rebuilds it in the background', async () => {
		const out_directory = create_out_directory()
		const error = silence_stderr()
		const builds = builds_of(recording_rebuild())

		write_stale_build(out_directory)

		expect(await ensure_bundle(probe_bundle(out_directory), builds)).toBe(true)
		expect(builds.rebuild).not.toHaveBeenCalled()
		expect(builds.start_rebuild).toHaveBeenCalledWith(out_directory)
		expect(error).toHaveBeenCalledWith(STALE_NOTICE)
	})

	// The slow source fallback is where a hook can time out and fail open, so it is never taken silently.
	it('warns that the hook may run unguarded when the rebuild fails', async () => {
		const error = silence_stderr()
		const bundle = probe_bundle(create_out_directory())

		expect(await ensure_bundle(bundle, builds_of(failing_rebuild))).toBe(false)
		expect(error).toHaveBeenCalledWith(expect.stringContaining(FAILED_NOTICE))
		expect(error).toHaveBeenCalledWith(expect.stringContaining(BUILD_ERROR))
	})
})

describe('ensure_bundle on a stale build without the hook', () => {
	it('rebuilds in the call when the stale build lacks the requested hook', async () => {
		const out_directory = create_out_directory()
		const builds = builds_of(recording_rebuild())

		silence_stderr()
		write_stale_build(out_directory)

		expect(await ensure_bundle(path.join(out_directory, 'new-hook.js'), builds)).toBe(true)
		expect(builds.rebuild).toHaveBeenCalledWith(out_directory)
		expect(builds.start_rebuild).not.toHaveBeenCalled()
	})
})

describe('ensure_bundle on a fresh build', () => {
	it(
		'leaves bundles built from the current source alone',
		async () => {
			const out_directory = create_out_directory()

			await build_hooks(out_directory)
			const builds = builds_of(recording_rebuild())

			expect(await ensure_bundle(path.join(out_directory, 'pretool-guard.js'), builds)).toBe(true)
			expect(builds.rebuild).not.toHaveBeenCalled()
			expect(builds.start_rebuild).not.toHaveBeenCalled()
		},
		BUILD_TIMEOUT_MS,
	)
})

describe('start_background_rebuild', () => {
	it('starts one detached rebuild while its lock is held', () => {
		const out_directory = create_out_directory()

		onTestFinished(() => {
			rmSync(rebuild_lock(out_directory), { force: true })
		})
		vi.mocked(spawn).mockImplementation(detached_child)
		start_background_rebuild(out_directory)
		start_background_rebuild(out_directory)

		expect(spawn).toHaveBeenCalledOnce()
		expect(vi.mocked(spawn).mock.calls[0]?.[1]).toEqual(
			expect.arrayContaining([REBUILD_FLAG, out_directory]),
		)
		expect(vi.mocked(spawn).mock.calls[0]?.[2]).toEqual({ detached: true, stdio: 'ignore' })
		expect(existsSync(rebuild_lock(out_directory))).toBe(true)
	})

	it('takes over a lock left by a rebuild that died', () => {
		const out_directory = create_out_directory()
		const lock = rebuild_lock(out_directory)

		onTestFinished(() => {
			rmSync(lock, { force: true })
		})
		writeFileSync(lock, '')
		utimesSync(lock, ABANDONED_TIME, ABANDONED_TIME)
		vi.mocked(spawn).mockImplementation(detached_child)
		start_background_rebuild(out_directory)

		expect(spawn).toHaveBeenCalledOnce()
	})
})

describe('rebuild_detached', () => {
	it('builds into the directory and releases the lock', async () => {
		const out_directory = create_out_directory()
		const rebuild = recording_rebuild()

		writeFileSync(rebuild_lock(out_directory), '')
		await rebuild_detached(out_directory, rebuild)

		expect(rebuild).toHaveBeenCalledWith(out_directory)
		expect(existsSync(rebuild_lock(out_directory))).toBe(false)
	})

	it('records a failed build and releases the lock, so the next launch reports it and tries again', async () => {
		const out_directory = create_out_directory()

		writeFileSync(rebuild_lock(out_directory), '')

		await expect(rebuild_detached(out_directory, failing_rebuild)).rejects.toThrow(BUILD_ERROR)
		expect(existsSync(rebuild_lock(out_directory))).toBe(false)
		expect(readFileSync(rebuild_failure(out_directory), 'utf8')).toBe(BUILD_ERROR)
	})

	it('clears the failure record once a build succeeds', async () => {
		const out_directory = create_out_directory()

		writeFileSync(rebuild_failure(out_directory), BUILD_ERROR)
		await rebuild_detached(out_directory, recording_rebuild())

		expect(existsSync(rebuild_failure(out_directory))).toBe(false)
	})
})

describe('ensure_bundle after a failed background rebuild', () => {
	it('says the edited source does not build instead of claiming a rebuild is under way', async () => {
		const out_directory = create_out_directory()
		const error = silence_stderr()
		const builds = builds_of(recording_rebuild())

		write_stale_build(out_directory)
		writeFileSync(rebuild_failure(out_directory), BUILD_ERROR)

		expect(await ensure_bundle(probe_bundle(out_directory), builds)).toBe(true)
		expect(builds.start_rebuild).toHaveBeenCalledWith(out_directory)
		expect(error).toHaveBeenCalledWith(`${FAILING_NOTICE} (${BUILD_ERROR})`)
	})
})

describe('import_bundle', () => {
	it('loads again once when a background build pruned a chunk the stale entry imports', async () => {
		const out_directory = realpathSync(create_out_directory())
		const bundle = probe_bundle(out_directory)
		const load = vi.fn(async (href: string) => {
			try {
				const loaded: unknown = await import(href)

				return loaded
			} finally {
				writeFileSync(path.join(out_directory, LATE_CHUNK), '')
			}
		})

		writeFileSync(bundle, `import './${LATE_CHUNK}'\n${PROBE_BUNDLE}`)
		process.argv.splice(1, process.argv.length, bundle, 'first')
		await import_bundle(bundle, load)

		expect(load).toHaveBeenCalledTimes(2)
		expect(Reflect.get(globalThis, PROBE_KEY)).toEqual(['first'])
	})

	it('rethrows a failure that is not a missing file of the bundle directory', async () => {
		const load = vi.fn(async () => {
			throw new Error(BUILD_ERROR)
		})

		const bundle = probe_bundle(create_out_directory())

		await expect(import_bundle(bundle, load)).rejects.toThrow(BUILD_ERROR)
		expect(load).toHaveBeenCalledOnce()
	})
})

describe('launch', () => {
	it('rebuilds missing bundles, then runs one in this process with the hook arguments', async () => {
		const out_directory = create_out_directory()
		const rebuild = vi.fn(async (directory: string) => {
			write_probe_bundle(directory)
		})

		silence_stderr()
		await launch(probe_launch(), out_directory, builds_of(rebuild))

		expect(rebuild).toHaveBeenCalledWith(out_directory)
		expect(Reflect.get(globalThis, PROBE_KEY)).toEqual(['first', 'second'])
	})

	it('runs a stale build without waiting for a rebuild', async () => {
		const out_directory = create_out_directory()
		const builds = builds_of(recording_rebuild())

		write_stale_build(out_directory)
		silence_stderr()
		await launch(probe_launch(), out_directory, builds)

		expect(builds.rebuild).not.toHaveBeenCalled()
		expect(Reflect.get(globalThis, PROBE_KEY)).toEqual(['first', 'second'])
	})

	it('runs the josh command from source when the bundles cannot be rebuilt', async () => {
		silence_stderr()
		vi.mocked(spawnSync).mockReturnValue(spawn_result(REFUSED))
		await launch(probe_launch(), create_out_directory(), builds_of(failing_rebuild))

		expect(spawnSync).toHaveBeenCalledWith(
			path.join(PACKAGE_ROOT, 'node_modules', '.bin', 'tsx'),
			[path.join(PACKAGE_ROOT, 'scripts', 'josh', 'josh.ts'), PROBE_COMMAND, 'first', 'second'],
			{ stdio: 'inherit' },
		)
		expect(vi.mocked(spawnSync).mock.calls[0]?.[2]).not.toHaveProperty('cwd')
		expect(process.exitCode).toBe(REFUSED)
	})
})

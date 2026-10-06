import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build_hooks } from '#scripts/build/build-hooks'
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
import { hook_bundle_ready, type HookLaunch } from './hook-bundle-ready'

vi.mock(import('node:child_process'), async (import_original) => ({
	...(await import_original()),
	spawnSync: vi.fn(),
}))

const { ensure_bundles, FAILED_NOTICE, launch, REBUILT_NOTICE } = hook_bundle_ready

const BUILD_TIMEOUT_MS = 60_000
const BUILD_ERROR = 'Transform failed'
const REFUSED = 2
const PROBE_KEY = 'hook_bundle_ready_probe'
const PROBE_HOOK = 'probe-hook'
const PROBE_COMMAND = 'probe:hook'
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

function create_out_directory(): string {
	const out_directory = mkdtempSync(path.join(tmpdir(), 'hook-bundle-ready-'))

	onTestFinished(() => {
		rmSync(out_directory, { recursive: true, force: true })
	})

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

describe('ensure_bundles', () => {
	it('rebuilds bundles that do not match the source and says so', async () => {
		const out_directory = create_out_directory()
		const error = silence_stderr()
		const rebuild = recording_rebuild()

		expect(await ensure_bundles(out_directory, rebuild)).toBe(true)
		expect(rebuild).toHaveBeenCalledWith(out_directory)
		expect(error).toHaveBeenCalledWith(REBUILT_NOTICE)
	})

	it(
		'leaves bundles built from the current source alone',
		async () => {
			const out_directory = create_out_directory()

			await build_hooks(out_directory)
			const rebuild = recording_rebuild()

			expect(await ensure_bundles(out_directory, rebuild)).toBe(true)
			expect(rebuild).not.toHaveBeenCalled()
		},
		BUILD_TIMEOUT_MS,
	)

	// The slow source fallback is where a hook can time out and fail open, so it is never taken silently.
	it('warns that the hook may run unguarded when the rebuild fails', async () => {
		const error = silence_stderr()

		expect(await ensure_bundles(create_out_directory(), failing_rebuild)).toBe(false)
		expect(error).toHaveBeenCalledWith(expect.stringContaining(FAILED_NOTICE))
		expect(error).toHaveBeenCalledWith(expect.stringContaining(BUILD_ERROR))
	})
})

describe('launch', () => {
	it('rebuilds stale bundles, then runs one in this process with the hook arguments', async () => {
		const out_directory = create_out_directory()
		const rebuild = vi.fn(async (directory: string) => {
			write_probe_bundle(directory)
		})

		silence_stderr()
		await launch(probe_launch(), out_directory, rebuild)

		expect(rebuild).toHaveBeenCalledWith(out_directory)
		expect(Reflect.get(globalThis, PROBE_KEY)).toEqual(['first', 'second'])
	})

	it('runs the josh command from source when the bundles cannot be rebuilt', async () => {
		silence_stderr()
		vi.mocked(spawnSync).mockReturnValue(spawn_result(REFUSED))
		await launch(probe_launch(), create_out_directory(), failing_rebuild)

		expect(spawnSync).toHaveBeenCalledWith('pnpm', ['josh', PROBE_COMMAND, 'first', 'second'], {
			stdio: 'inherit',
		})
		expect(process.exitCode).toBe(REFUSED)
	})
})

import { spawnSync, type SpawnSyncReturns } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { build_hooks } from '#scripts/build/build-hooks'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { hook_bundle_fast } from '#tools/hooks/hook-bundle-fast'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock(import('node:child_process'), async (import_original) => ({
	...(await import_original()),
	spawnSync: vi.fn(),
}))

const { launch, SOURCE_GATE } = hook_bundle_fast
const BUILD_TIMEOUT_MS = 60_000
const REFUSED = 2
const make_directory = temporary_directory()
const { STAMP_NAME } = hook_bundle_stamp
const PROBE_KEY = 'hook_bundle_fast_probe'
const PROBE_HOOK = 'probe-hook'
const LAUNCH_ARGUMENTS = [PROBE_HOOK, 'probe:hook', 'first', 'second']
// A hook bundle in miniature: it runs its main only when launched as `argv[1]`, as every hook does.
const PROBE_BUNDLE = [
	"import { fileURLToPath } from 'node:url'",
	`if (process.argv[1] === fileURLToPath(import.meta.url)) globalThis.${PROBE_KEY} = process.argv.slice(2)`,
].join('\n')

function create_out_directory(): string {
	const out_directory = path.join(make_directory('hook-bundle-fast-'), 'hooks')

	mkdirSync(out_directory)

	return out_directory
}

function spawn_result(status: number): SpawnSyncReturns<string> {
	// eslint-disable-next-line unicorn/no-null -- spawnSync reports an exit with no signal as null
	return { pid: 0, output: [], stdout: '', stderr: '', status, signal: null }
}

const saved = { argv: [...process.argv] }

beforeEach(() => {
	saved.argv = [...process.argv]
})

afterEach(() => {
	vi.clearAllMocks()
	process.argv = saved.argv
	process.exitCode = undefined
	Reflect.deleteProperty(globalThis, PROBE_KEY)
})

describe('launch on a fresh build', () => {
	it(
		'runs the bundle in this process without starting the TypeScript gate',
		async () => {
			const out_directory = create_out_directory()

			await build_hooks(out_directory)
			writeFileSync(path.join(out_directory, `${PROBE_HOOK}.js`), PROBE_BUNDLE)
			await launch(LAUNCH_ARGUMENTS, out_directory)

			expect(spawnSync).not.toHaveBeenCalled()
			expect(Reflect.get(globalThis, PROBE_KEY)).toEqual(['first', 'second'])
		},
		BUILD_TIMEOUT_MS,
	)

	// A shared chunk pruned by a background rebuild would fail a launch that read the old ready.js.
	it(
		'builds the launch gate as one file that links no shared chunk',
		async () => {
			const out_directory = create_out_directory()

			await build_hooks(out_directory)

			expect(readFileSync(path.join(out_directory, 'ready.js'), 'utf8')).not.toContain('./chunk-')
		},
		BUILD_TIMEOUT_MS,
	)
})

describe('launch on a build that is not fresh', () => {
	it('hands the whole launch to the source gate, which owns the rebuilds', async () => {
		const out_directory = create_out_directory()

		writeFileSync(path.join(out_directory, `${PROBE_HOOK}.js`), PROBE_BUNDLE)
		writeFileSync(
			path.join(out_directory, STAMP_NAME),
			hook_bundle_stamp.stamp_text(new Map(), [`${PROBE_HOOK}.js`]),
		)
		vi.mocked(spawnSync).mockReturnValue(spawn_result(REFUSED))
		await launch(LAUNCH_ARGUMENTS, out_directory)

		expect(spawnSync).toHaveBeenCalledWith(
			process.execPath,
			['--disable-warning=ExperimentalWarning', SOURCE_GATE, ...LAUNCH_ARGUMENTS],
			{ stdio: 'inherit' },
		)
		expect(Reflect.get(globalThis, PROBE_KEY)).toBeUndefined()
		expect(process.exitCode).toBe(REFUSED)
	})

	it('hands an empty bundle directory to the source gate to build in the call', async () => {
		vi.mocked(spawnSync).mockReturnValue(spawn_result(0))
		await launch(LAUNCH_ARGUMENTS, create_out_directory())

		expect(vi.mocked(spawnSync).mock.calls[0]?.[1]).toContain(SOURCE_GATE)
		expect(process.exitCode).toBe(0)
	})
})

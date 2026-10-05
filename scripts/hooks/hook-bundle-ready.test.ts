import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { build_hooks } from '#scripts/build/build-hooks'
import { execa } from 'execa'
import {
	afterEach,
	describe,
	expect,
	it,
	onTestFinished,
	vi,
	type Mock,
	type MockInstance,
} from 'vitest'
import { hook_bundle_ready } from './hook-bundle-ready'

const { ensure_bundles, FAILED_NOTICE, REBUILT_NOTICE } = hook_bundle_ready

const BUILD_TIMEOUT_MS = 60_000
const BUILD_ERROR = 'Transform failed'
// The gate exactly as `scripts/hooks/run-hook.sh` launches it in kit's own checkout.
const READY_GATE = 'node --disable-warning=ExperimentalWarning scripts/hooks/hook-bundle-ready.ts'

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

afterEach(() => {
	vi.restoreAllMocks()
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

// The gate is launched by plain `node` on every hook call, with no tsx to resolve its imports.
describe('the gate as a hook command runs it', () => {
	it(
		'passes under plain node without writing to stdout',
		async () => {
			const result = await execa('sh', ['-c', READY_GATE], { reject: false })

			expect(result.exitCode).toBe(0)
			expect(result.stdout).toBe('')
		},
		BUILD_TIMEOUT_MS,
	)
})

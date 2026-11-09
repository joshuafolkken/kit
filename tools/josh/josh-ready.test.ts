import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { bundle_rebuild_lock } from '#tools/hooks/bundle-rebuild-lock'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
	FAILED_NOTICE,
	launch,
	launch_target,
	STILL_STALE_NOTICE,
	type Rebuild,
} from './josh-ready'

const INPUT = 'source.ts'
const make_directory = temporary_directory('suite')
const OUTPUT = 'josh.js'
const SOURCE = 'export const value = 1'
const EDITED_SOURCE = 'export const value = 2'
const FAILURE = 7
const root = make_directory('josh-ready-')
const original_argv = process.argv
const MANIFEST = 'package.json'
const MANIFEST_CONTENT = '{"type":"module"}'
const BUNDLE = 'dist/josh.js'
const ENTRY = 'scripts/josh/josh.ts'
const SPACED_ARGUMENT = 'argument with spaces'
const OTHER_BUILD_MS = 250
const EXECUTABLE_MODE = 0o755
const COMMANDS = 'dist/commands'

function write_bundle(directory: string, source: string): void {
	const sources = new Map([
		[INPUT, Buffer.from(source)],
		[MANIFEST, Buffer.from(MANIFEST_CONTENT)],
	])
	const stamp = hook_bundle_stamp.stamp_text(sources, [OUTPUT])

	mkdirSync(directory, { recursive: true })
	writeFileSync(path.join(directory, OUTPUT), '')
	writeFileSync(path.join(directory, hook_bundle_stamp.STAMP_NAME), stamp)
}

beforeEach(() => {
	mkdirSync(root, { recursive: true })
	writeFileSync(path.join(root, INPUT), SOURCE)
	writeFileSync(path.join(root, MANIFEST), MANIFEST_CONTENT)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
	process.argv = original_argv
	process.exitCode = undefined
	vi.restoreAllMocks()
	rmSync(root, { recursive: true, force: true })
})

// Include the manifest, as the shared hook check requires every toolchain input.
function ready_bundles(source: string = SOURCE): void {
	for (const directory of [path.join(root, 'dist'), path.join(root, COMMANDS)]) {
		write_bundle(directory, source)
	}
}

function failing_build(): void {
	throw new Error('build failed')
}

// What `pnpm build` leaves after the edit: bundles stamped with the edited source.
function edited_build(): void {
	ready_bundles(EDITED_SOURCE)
}

describe('josh startup with a fresh dist (ac-2bac80a6)', () => {
	it('selects dist without rebuilding when both dispatcher and command bundles are fresh', async () => {
		const rebuild = vi.fn<Rebuild>()

		ready_bundles()

		await expect(launch_target(root, rebuild)).resolves.toBe(path.join(root, BUNDLE))
		expect(rebuild).not.toHaveBeenCalled()
	})
})

describe('josh startup with a stale dist (ac-05c27eab, ac-d8bcc144)', () => {
	it('rebuilds after a recorded input changes, then selects the new dist', async () => {
		const rebuild = vi.fn<Rebuild>(edited_build)
		const lock = bundle_rebuild_lock.lock_path(path.join(root, COMMANDS))

		ready_bundles()
		writeFileSync(path.join(root, INPUT), EDITED_SOURCE)

		await expect(launch_target(root, rebuild)).resolves.toBe(path.join(root, BUNDLE))
		expect(rebuild).toHaveBeenCalledExactlyOnceWith(root)
		expect(bundle_rebuild_lock.claim(lock)).toBe(true)
	})

	it('runs the source, never the old bundle, when the source is edited again during the build', async () => {
		ready_bundles()
		writeFileSync(path.join(root, INPUT), EDITED_SOURCE)

		const target = await launch_target(root, () => {
			edited_build()
			writeFileSync(path.join(root, INPUT), 'export const value = 3')
		})

		expect(target).toBe(path.join(root, ENTRY))
		expect(console.error).toHaveBeenCalledWith(STILL_STALE_NOTICE)
	})
})

describe('josh startup when the rebuild fails', () => {
	it.each(['dist/inputs.json', BUNDLE, 'dist/commands/inputs.json', 'dist/commands/josh.js'])(
		'falls back to source when %s is missing and the rebuild fails',
		async (missing) => {
			ready_bundles()
			rmSync(path.join(root, missing))

			await expect(launch_target(root, failing_build)).resolves.toBe(path.join(root, ENTRY))
			expect(console.error).toHaveBeenCalledWith(FAILED_NOTICE)
		},
	)

	it('falls back to source before the first build when the build fails', async () => {
		await expect(launch_target(root, failing_build)).resolves.toBe(path.join(root, ENTRY))
	})

	it('treats a non-zero exit of the checkout build as a failed rebuild', async () => {
		const tsx = path.join(root, 'node_modules/.bin/tsx')

		mkdirSync(path.dirname(tsx), { recursive: true })
		writeFileSync(tsx, '#!/bin/sh\nexit 3\n', { mode: EXECUTABLE_MODE })

		await expect(launch_target(root)).resolves.toBe(path.join(root, ENTRY))
		expect(console.error).toHaveBeenCalledWith(FAILED_NOTICE)
	})
})

// Another launch's build, holding the lock until it ends — with fresh bundles when it succeeds.
async function build_elsewhere(lock: string, is_successful: boolean): Promise<void> {
	await sleep(OTHER_BUILD_MS)
	if (is_successful) ready_bundles()
	bundle_rebuild_lock.release(lock)
}

async function launch_beside_other_build(
	is_successful: boolean,
	rebuild: Rebuild,
): Promise<string> {
	const lock = bundle_rebuild_lock.lock_path(path.join(root, COMMANDS))

	mkdirSync(path.dirname(lock), { recursive: true })
	writeFileSync(lock, '')
	const [target] = await Promise.all([
		launch_target(root, rebuild),
		build_elsewhere(lock, is_successful),
	])

	return target
}

describe('josh startup while another launch rebuilds', () => {
	it('waits for the lock holder and uses the dist it built', async () => {
		const rebuild = vi.fn<Rebuild>()

		await expect(launch_beside_other_build(true, rebuild)).resolves.toBe(path.join(root, BUNDLE))
		expect(rebuild).not.toHaveBeenCalled()
	})

	it('runs the source without building again when the lock holder build failed', async () => {
		const rebuild = vi.fn<Rebuild>()

		await expect(launch_beside_other_build(false, rebuild)).resolves.toBe(path.join(root, ENTRY))
		expect(rebuild).not.toHaveBeenCalled()
		expect(console.error).toHaveBeenCalledWith(STILL_STALE_NOTICE)
	})
})

describe('josh startup execution', () => {
	it.each([BUNDLE, ENTRY])('forwards argv and the exit code through %s', async (target) => {
		if (target.endsWith('.js')) ready_bundles()
		const entry = path.join(root, target)

		mkdirSync(path.dirname(entry), { recursive: true })
		writeFileSync(
			path.join(path.dirname(entry), 'dependency.ts'),
			`export const code = ${String(FAILURE)}`,
		)
		const source = target.endsWith('.ts')
			? "import { code } from './dependency'; process.exitCode = code"
			: `process.exitCode = ${String(FAILURE)}`

		writeFileSync(entry, source)
		process.argv = [process.execPath, 'launcher', 'help', SPACED_ARGUMENT]
		await launch(root, failing_build)

		expect(process.argv).toStrictEqual([process.execPath, entry, 'help', SPACED_ARGUMENT])
		expect(process.exitCode).toBe(FAILURE)
	})
})

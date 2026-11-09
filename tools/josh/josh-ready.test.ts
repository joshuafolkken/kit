import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { setTimeout as sleep } from 'node:timers/promises'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { bundle_rebuild_lock } from '#tools/hooks/bundle-rebuild-lock'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { launch, launch_target, type Rebuild } from './josh-ready'

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
	})

	it.each(['dist/inputs.json', BUNDLE, 'dist/commands/inputs.json', 'dist/commands/josh.js'])(
		'falls back to source when %s is missing and the rebuild fails',
		async (missing) => {
			ready_bundles()
			rmSync(path.join(root, missing))

			await expect(launch_target(root, failing_build)).resolves.toBe(path.join(root, ENTRY))
		},
	)

	it('falls back to source before the first build when the build fails', async () => {
		await expect(launch_target(root, failing_build)).resolves.toBe(path.join(root, ENTRY))
	})
})

// Another launch's build, holding the lock until it has written fresh bundles.
async function build_elsewhere(lock: string): Promise<void> {
	await sleep(OTHER_BUILD_MS)
	ready_bundles()
	bundle_rebuild_lock.release(lock)
}

describe('josh startup while another launch rebuilds', () => {
	it('waits for the lock holder and uses the dist it built', async () => {
		const rebuild = vi.fn<Rebuild>()
		const lock = bundle_rebuild_lock.lock_path(path.join(root, COMMANDS))

		mkdirSync(path.dirname(lock), { recursive: true })
		writeFileSync(lock, '')
		const other_build = build_elsewhere(lock)

		await expect(launch_target(root, rebuild)).resolves.toBe(path.join(root, BUNDLE))
		await other_build
		expect(rebuild).not.toHaveBeenCalled()
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

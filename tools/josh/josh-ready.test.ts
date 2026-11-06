import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { hook_bundle_stamp } from '#scripts/build/hook-bundle-stamp'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { launch, launch_target } from './josh-ready'

const INPUT = 'source.ts'
const make_directory = temporary_directory('suite')
const OUTPUT = 'josh.js'
const SOURCE = 'export const value = 1'
const FAILURE = 7
const root = make_directory('josh-ready-')
const original_argv = process.argv
const MANIFEST = 'package.json'
const MANIFEST_CONTENT = '{"type":"module"}'
const BUNDLE = 'dist/josh.js'
const ENTRY = 'scripts/josh/josh.ts'
const SPACED_ARGUMENT = 'argument with spaces'

function write_bundle(directory: string): void {
	const sources = new Map([
		[INPUT, Buffer.from(SOURCE)],
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
})

afterEach(() => {
	process.argv = original_argv
	process.exitCode = undefined
	rmSync(root, { recursive: true, force: true })
})

// Include the manifest, as the shared hook check requires every toolchain input.
function ready_bundles(): void {
	for (const directory of [path.join(root, 'dist'), path.join(root, 'dist/commands')]) {
		write_bundle(directory)
	}
}

describe('josh startup freshness (ac-f00ae512, ac-2b1de99b, ac-d0c6d5a8)', () => {
	it('selects dist only when both dispatcher and command bundles are fresh', () => {
		ready_bundles()

		expect(launch_target(root)).toBe(path.join(root, BUNDLE))
	})

	it.each(['dist/inputs.json', BUNDLE, 'dist/commands/inputs.json', 'dist/commands/josh.js'])(
		'falls back to source when %s is missing',
		(missing) => {
			ready_bundles()
			rmSync(path.join(root, missing))

			expect(launch_target(root)).toBe(path.join(root, ENTRY))
		},
	)

	it('falls back to source after a recorded input changes', () => {
		ready_bundles()
		writeFileSync(path.join(root, INPUT), 'export const value = 2')

		expect(launch_target(root)).toBe(path.join(root, ENTRY))
	})

	it('falls back to source before the first build', () => {
		expect(launch_target(root)).toBe(path.join(root, ENTRY))
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
		await launch(root)

		expect(process.argv).toStrictEqual([process.execPath, entry, 'help', SPACED_ARGUMENT])
		expect(process.exitCode).toBe(FAILURE)
	})
})

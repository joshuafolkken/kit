import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { json_value } from '#scripts/lib/json-value'
import { beforeAll, describe, expect, it } from 'vitest'
import { build_bin, NODE_BANNER, OUTFILE } from './build-bin'
import { hook_bundle_stamp } from './hook-bundle-stamp'

const BUILD_TIMEOUT = 60_000
const EXECUTABLE_MODE = 0o755

beforeAll(async () => {
	await build_bin()
}, BUILD_TIMEOUT)

describe('build_bin — compiled output', () => {
	it(
		'preserves executable permissions when rebuilding a linked CLI',
		async () => {
			chmodSync(OUTFILE, EXECUTABLE_MODE)
			const expected_mode = statSync(OUTFILE).mode

			await build_bin()

			expect(statSync(OUTFILE).mode).toBe(expected_mode)
		},
		BUILD_TIMEOUT,
	)
	it('records the bundled source for the shared freshness check (ac-d0c6d5a8)', () => {
		const directory = path.dirname(OUTFILE)

		expect(hook_bundle_stamp.is_fresh(directory, path.dirname(directory))).toBe(true)
	})
	it('records its own build configuration among the freshness inputs', () => {
		const stamp_file = path.join(path.dirname(OUTFILE), hook_bundle_stamp.STAMP_NAME)
		const stamp = json_value.parse_or_undefined(readFileSync(stamp_file, 'utf8'))
		const inputs = json_value.is_record(stamp) ? stamp['inputs'] : undefined

		expect(inputs).toContain('scripts/build/build-bin.ts')
	})
	it('writes the bundled bin to dist/josh.js', () => {
		expect(existsSync(OUTFILE)).toBe(true)
	})

	it('prepends the node shebang banner', () => {
		const content = readFileSync(OUTFILE, 'utf8')

		expect(content.startsWith(NODE_BANNER)).toBe(true)
	})
})

describe('build_bin — standalone execution via node', () => {
	it('runs help without tsx and resolves the package version from the bin location', () => {
		const result = spawnSync('node', [OUTFILE, 'help'], { encoding: 'utf8' })

		expect(result.status).toBe(0)
		expect(result.stdout).toContain('josh v')
		expect(result.stdout).toContain('Usage: josh')
	})
})

import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { beforeAll, describe, expect, it } from 'vitest'
import { build_bin, NODE_BANNER, OUTFILE } from './build-bin'

const BUILD_TIMEOUT = 60_000

beforeAll(async () => {
	await build_bin()
}, BUILD_TIMEOUT)

describe('build_bin — compiled output', () => {
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

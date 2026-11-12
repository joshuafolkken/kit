import { readFileSync } from 'node:fs'
import { package_path } from '#scripts/init/init-paths'
import { describe, expect, it } from 'vitest'
import { classify } from './change-scope-action'

const PACKAGE = {
	files: ['scripts', 'prompts', '!**/*.test.ts', '!**/__snapshots__'],
	version: '1.0.0',
}
const BUMP = { ...PACKAGE, version: '1.0.1' }
const DOC = 'docs/guide.md'
const README = 'README.md'
const MANIFEST = 'package.json'
const CODE = 'scripts/run.ts'
const TEST = 'scripts/a.test.ts'
const PROMPT = 'prompts/workflow.md'

describe('documentation and package change classification', () => {
	it('reads the real distribution list including prompts and its test exclusions', () => {
		const manifest = JSON.parse(readFileSync(package_path(MANIFEST), 'utf8')) as {
			files: Array<string>
		}

		expect(classify([PROMPT], manifest, manifest).publish).toBe(true)
		expect(classify([DOC], manifest, manifest).publish).toBe(false)
		expect(classify([TEST], manifest, manifest).publish).toBe(false)
	})
	it.each([DOC, README, PROMPT])('skips executable checks for %s', (path) => {
		expect(classify([path, MANIFEST], PACKAGE, BUMP).runtime).toBe(false)
	})
})

describe('code and consumer package classification', () => {
	it('keeps checks for code mixed into documentation', () => {
		expect(classify([DOC, CODE], PACKAGE, BUMP).runtime).toBe(true)
	})
	it.each([DOC, TEST, 'scripts/__snapshots__/a.snap', 'scripts-other/a.ts'])(
		'does not publish %s',
		(path) => {
			expect(classify([path], PACKAGE, PACKAGE).publish).toBe(false)
		},
	)
	it.each([PROMPT, CODE, README, 'LICENSE', 'pnpm-lock.yaml', '.npmrc', 'eslint.config.js'])(
		'publishes consumer input %s',
		(path) => {
			expect(classify([path], PACKAGE, PACKAGE).publish).toBe(true)
		},
	)
	it('publishes package metadata changes', () => {
		expect(classify([MANIFEST], PACKAGE, { ...BUMP, main: 'new.js' }).publish).toBe(true)
	})
	it('uses both revisions when an exclusion or a distributed directory is removed', () => {
		expect(classify([TEST], PACKAGE, { files: ['scripts'] }).publish).toBe(true)
		expect(classify([CODE], PACKAGE, { files: [] }).publish).toBe(true)
	})
})

describe('release version classification', () => {
	it('publishes a version-only bump without running checks', () => {
		expect(classify([MANIFEST], PACKAGE, BUMP)).toEqual({ runtime: false, publish: true })
	})
	it('publishes a release commit that also drops accepted metrics', () => {
		expect(classify([MANIFEST, '.josh/metrics-accepted/x.json'], PACKAGE, BUMP)).toEqual({
			runtime: true,
			publish: true,
		})
	})
	it('does not publish a package.json change that leaves the manifest unchanged', () => {
		expect(classify([MANIFEST], PACKAGE, PACKAGE)).toEqual({ runtime: false, publish: false })
	})
})

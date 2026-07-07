import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { PACKAGE_DIR, package_path, PROJECT_ROOT } from './init-paths'

describe('PACKAGE_DIR', () => {
	it('is an absolute path', () => {
		expect(path.isAbsolute(PACKAGE_DIR)).toBe(true)
	})
})

describe('PROJECT_ROOT', () => {
	it('equals process.cwd()', () => {
		expect(PROJECT_ROOT).toBe(process.cwd())
	})
})

describe('package_path', () => {
	it('joins PACKAGE_DIR with a relative path', () => {
		expect(package_path('foo/bar')).toBe(path.join(PACKAGE_DIR, 'foo/bar'))
	})
})

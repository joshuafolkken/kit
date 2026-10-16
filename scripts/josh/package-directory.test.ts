import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { find_package_directory } from './package-directory'

const root = mkdtempSync(path.join(tmpdir(), 'package-directory-'))

afterAll(() => {
	rmSync(root, { recursive: true, force: true })
})

describe('find_package_directory', () => {
	it('ascends to the nearest directory holding a package.json', () => {
		const nested = path.join(root, 'scripts', 'josh')

		mkdirSync(nested, { recursive: true })
		writeFileSync(path.join(root, 'package.json'), '{}')

		expect(find_package_directory(nested)).toBe(root)
	})

	it('answers the start directory when no ancestor holds a package.json', () => {
		const start = path.parse(root).root

		expect(find_package_directory(start)).toBe(start)
	})
})

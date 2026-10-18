import { describe, expect, it } from 'vitest'
import { toolchain_config } from './toolchain-config'

// joshuafolkken/kit#4085: the files a check narrowing by the change cannot narrow past, read by both
// the gate's reuse (`check-inputs.ts`) and its lint (`lint-gate-scope.ts`).

const PACKAGE_JSON = 'package.json'
const SOURCE_FILE = 'scripts/thing.ts'

describe('toolchain_config.is_config', () => {
	it.each([
		PACKAGE_JSON,
		'pnpm-lock.yaml',
		'.npmrc',
		'.editorconfig',
		'.gitignore',
		'.prettierignore',
		'.prettierrc.json',
		'packages/app/package.json',
	])('reads %j as a toolchain file', (relative) => {
		expect(toolchain_config.is_config(relative)).toBe(true)
	})

	it.each([SOURCE_FILE, 'README.md', 'cspell.config.yaml'])('leaves %j out', (relative) => {
		expect(toolchain_config.is_config(relative)).toBe(false)
	})
})

describe('toolchain_config.has_config', () => {
	it('answers whether any of the paths is a toolchain file', () => {
		expect(toolchain_config.has_config([SOURCE_FILE, PACKAGE_JSON])).toBe(true)
		expect(toolchain_config.has_config([SOURCE_FILE])).toBe(false)
	})
})

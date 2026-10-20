import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { import_closure } from './import-closure-fixture'

// `pnpm build` runs every step from `build.ts`, so the step modules it imports carry no main guard of
// their own: a bundle is one file, and a guard in an imported module fires with the entry's
// (joshuafolkken/kit#4186).
const BUILD_ENTRY = 'scripts/build/build.ts'
const STEP_MODULES: ReadonlyArray<string> = [
	'scripts/build/build-bin.ts',
	'scripts/build/build-claude-md.ts',
	'scripts/build/build-commands.ts',
	'scripts/build/build-hooks.ts',
]

function package_build_script(): unknown {
	const manifest: unknown = JSON.parse(readFileSync('package.json', 'utf8'))

	return typeof manifest === 'object' && manifest !== null && 'scripts' in manifest
		? manifest.scripts
		: undefined
}

describe('build entry', () => {
	it('is the one script pnpm build runs', () => {
		expect(package_build_script()).toMatchObject({ build: `tsx ${BUILD_ENTRY}` })
	})

	it('keeps its own main guard', () => {
		expect(import_closure.has_main_guard(BUILD_ENTRY)).toBe(true)
	})

	it.each(STEP_MODULES)('%s carries no main guard', (module_path) => {
		expect(import_closure.has_main_guard(module_path)).toBe(false)
	})
})

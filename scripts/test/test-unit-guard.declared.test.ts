import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { temporary_directory } from '#tools/test/temporary-directory'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SKIP_MARKER } from './skip-marker'
import { test_unit_guard } from './test-unit-guard'

// joshuafolkken/kit#9095: a checkout whose dependencies were never installed must not pass the unit
// check on the young-project skip when its package.json declares vitest.
const make_directory = temporary_directory()
const RELATED_LABEL = 'test:related'
const DECLARED = { vitest: '^4.0.0' }
const FAIL_MISSING = 'fail-missing-package'

function write_project(directory: string, development_dependencies: Record<string, string>): void {
	const unit_file = path.join(directory, 'src', 'sample.test.ts')

	mkdirSync(path.dirname(unit_file), { recursive: true })
	writeFileSync(unit_file, '')
	writeFileSync(
		path.join(directory, 'package.json'),
		JSON.stringify({ name: 'fixture', devDependencies: development_dependencies }),
	)
}

function full_project(development_dependencies: Record<string, string>): string {
	const directory = make_directory('unit-guard-declared-')

	write_project(directory, development_dependencies)

	return directory
}

// A checkout that declares vitest and has no `node_modules` of its own, nested in one that holds the
// dependencies — a worktree under its main checkout.
function nested_project(): string {
	const parent = make_directory('unit-guard-nested-')
	const directory = path.join(parent, '.claude', 'worktrees', 'sample')

	mkdirSync(path.join(parent, 'node_modules', 'vitest'), { recursive: true })
	write_project(directory, DECLARED)

	return directory
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('test_unit_guard — vitest resolved from an ancestor checkout', () => {
	it('runs a project without its own node_modules whose parent checkout has vitest', () => {
		const directory = nested_project()

		expect(test_unit_guard.is_vitest_installed(directory)).toBe(true)
		expect(test_unit_guard.guard_action(directory)).toBe('run')
		expect(test_unit_guard.is_running(directory)).toBe(true)
	})

	it('refuses the same project when no ancestor has vitest', () => {
		const directory = full_project(DECLARED)

		expect(test_unit_guard.is_vitest_installed(directory)).toBe(false)
		expect(test_unit_guard.guard_action(directory)).toBe(FAIL_MISSING)
	})
})

describe('test_unit_guard — vitest declared but not installed', () => {
	it('fails instead of skipping when package.json declares vitest', async () => {
		const directory = full_project(DECLARED)
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(test_unit_guard.guard_action(directory)).toBe(FAIL_MISSING)
		await expect(test_unit_guard.run_guarded_vitest(directory, [], RELATED_LABEL)).resolves.toBe(1)
		expect(String(error.mock.calls[0]?.[0])).toContain('node_modules/vitest is missing')
		expect(info).not.toHaveBeenCalled()
		expect(test_unit_guard.is_skipping(directory)).toBe(false)
	})

	it('keeps the skip when package.json does not declare vitest', async () => {
		const directory = full_project({})
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(test_unit_guard.guard_action(directory)).toBe('skip-missing-package')
		await expect(test_unit_guard.run_guarded_vitest(directory, [], RELATED_LABEL)).resolves.toBe(0)
		expect(String(info.mock.calls[0]?.[0])).toContain(SKIP_MARKER)
	})
})

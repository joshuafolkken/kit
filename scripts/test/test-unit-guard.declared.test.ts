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

function full_project(development_dependencies: Record<string, string>): string {
	const directory = make_directory('unit-guard-declared-')
	const unit_file = path.join(directory, 'src', 'sample.test.ts')

	mkdirSync(path.dirname(unit_file), { recursive: true })
	writeFileSync(unit_file, '')
	writeFileSync(
		path.join(directory, 'package.json'),
		JSON.stringify({ name: 'fixture', devDependencies: development_dependencies }),
	)

	return directory
}

afterEach(() => {
	vi.restoreAllMocks()
})

describe('test_unit_guard — vitest declared but not installed', () => {
	it('fails instead of skipping when package.json declares vitest', async () => {
		const directory = full_project({ vitest: '^4.0.0' })
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		expect(test_unit_guard.guard_action(directory)).toBe('fail-missing-package')
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

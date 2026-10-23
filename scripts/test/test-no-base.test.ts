import path from 'node:path'
import { project_checks } from '#scripts/gate/project-checks'
import { no_base_checkout } from '#scripts/git/no-base-checkout'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_no_base } from './test-no-base'
import { test_unit_guard } from './test-unit-guard'

vi.mock('#scripts/git/no-base-checkout', () => ({
	no_base_checkout: { create: vi.fn(), remove: vi.fn() },
}))
vi.mock('./test-unit-guard', () => ({ test_unit_guard: { run_vitest_in: vi.fn() } }))

const mocked_create = vi.mocked(no_base_checkout.create)
const mocked_remove = vi.mocked(no_base_checkout.remove)
const mocked_run = vi.mocked(test_unit_guard.run_vitest_in)

// Real files of this repository: one resolves the base, one never names it.
const ROOT = process.cwd()
const BASE_FILE = path.join('scripts', 'git', 'change-base.ts')
const OTHER_FILE = path.join('scripts', 'gate', 'busy-average.ts')
const DOCUMENT = 'README.md'
const CHECKOUT = 'josh-no-base-fixture'
const FAILED = 1

beforeEach(() => {
	vi.spyOn(process.stdout, 'write').mockReturnValue(true)
	mocked_create.mockResolvedValue(CHECKOUT)
	mocked_run.mockResolvedValue(0)
})

afterEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

describe('test_no_base.touching', () => {
	it('keeps only the code files that name the base branch or its resolution', () => {
		expect(test_no_base.touching(ROOT, [BASE_FILE, OTHER_FILE, DOCUMENT])).toStrictEqual([
			BASE_FILE,
		])
	})

	it('reads a file the tree no longer holds as touching nothing', () => {
		expect(test_no_base.touching(ROOT, ['scripts/no-such-file.ts'])).toStrictEqual([])
	})
})

describe('test_no_base.run_if_touched', () => {
	it('runs the related tests of the touching files in the no-base checkout, then removes it', async () => {
		const exit_code = await test_no_base.run_if_touched(ROOT, [BASE_FILE, OTHER_FILE], ['--silent'])

		expect(exit_code).toBe(0)
		expect(mocked_create).toHaveBeenCalledWith(ROOT)
		expect(mocked_run).toHaveBeenCalledWith(CHECKOUT, ['related', BASE_FILE, '--run', '--silent'])
		expect(mocked_remove).toHaveBeenCalledWith(CHECKOUT)
	})

	it('answers the checkout run’s failure and still removes the checkout', async () => {
		mocked_run.mockResolvedValue(FAILED)

		await expect(test_no_base.run_if_touched(ROOT, [BASE_FILE], [])).resolves.toBe(FAILED)
		expect(mocked_remove).toHaveBeenCalledWith(CHECKOUT)
	})

	it('builds no checkout in a consumer project, whose ignored generated files it would lack', async () => {
		vi.spyOn(project_checks, 'is_kit_repository').mockReturnValue(false)

		await expect(test_no_base.run_if_touched(ROOT, [BASE_FILE], [])).resolves.toBe(0)
		expect(mocked_create).not.toHaveBeenCalled()
	})

	it('builds no checkout and starts no vitest for a change that touches no base resolution', async () => {
		await expect(test_no_base.run_if_touched(ROOT, [OTHER_FILE, DOCUMENT], [])).resolves.toBe(0)
		expect(mocked_create).not.toHaveBeenCalled()
		expect(mocked_run).not.toHaveBeenCalled()
	})
})

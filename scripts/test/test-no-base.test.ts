import path from 'node:path'
import { project_checks } from '#scripts/gate/project-checks'
import { no_base_checkout } from '#scripts/git/no-base-checkout'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_no_base } from './test-no-base'
import { test_related_claim } from './test-related-claim'
import { test_unit_guard } from './test-unit-guard'

vi.mock('#scripts/git/no-base-checkout', () => ({
	no_base_checkout: { create: vi.fn(), remove: vi.fn() },
}))
vi.mock('./test-unit-guard', () => ({ test_unit_guard: { run_vitest_in: vi.fn() } }))

const mocked_create = vi.mocked(no_base_checkout.create)
const mocked_remove = vi.mocked(no_base_checkout.remove)
const mocked_run = vi.mocked(test_unit_guard.run_vitest_in)

// Real files of this repository: one resolves the base, one never imports it.
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
})

describe('test_no_base.touching', () => {
	it('keeps only the code files that are or import the base branch resolution', () => {
		expect(test_no_base.touching(ROOT, [BASE_FILE, OTHER_FILE, DOCUMENT])).toStrictEqual([
			BASE_FILE,
		])
	})

	it('keeps a base module that imports neither root itself', () => {
		const wrapper = path.join('scripts', 'git', 'changed-file-scope.ts')

		expect(test_no_base.touching(ROOT, [wrapper])).toStrictEqual([wrapper])
	})

	it('reads a file the tree no longer holds as touching nothing', () => {
		expect(test_no_base.touching(ROOT, ['scripts/no-such-file.ts'])).toStrictEqual([])
	})
})

// joshuafolkken/kit#6186: the import decides, not a string the text happens to hold.
describe('test_no_base.imports_base', () => {
	const IMPORTS = Object.fromEntries([['#scripts/*', './scripts/*.ts']])
	const FILE = 'scripts/gate/fixture.ts'

	it('keeps a file that imports a base-resolution module, by alias or relative path', () => {
		const aliased = "import { change_base } from '#scripts/git/change-base'\n"
		const relative = "import { git_diff_reads } from '../git/git-diff-reads'\n"
		const named_type = "import type from '#scripts/git/change-base'\n"

		expect(test_no_base.imports_base(aliased, FILE, IMPORTS)).toBe(true)
		expect(test_no_base.imports_base(relative, FILE, IMPORTS)).toBe(true)
		expect(test_no_base.imports_base(named_type, FILE, IMPORTS)).toBe(true)
	})

	it.each([
		[
			'only names the default branch as a string',
			'const BRANCH = \'main\'\nconst OTHER = "main"\n',
		],
		[
			'calls a wrapper, which hands it paths already resolved',
			"import { changed_paths } from '#scripts/git/changed-paths'\n",
		],
		[
			'imports a type alone, which resolves nothing at run time',
			"import type { ChangeBase } from '#scripts/git/change-base'\n",
		],
	])('leaves out a file that %s', (_case, source) => {
		expect(test_no_base.imports_base(source, FILE, IMPORTS)).toBe(false)
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

	// joshuafolkken/kit#5135: the first pass's claim is released before this one starts.
	it('runs the checkout pass inside its own claim, sized by the touching files', async () => {
		const claim = vi
			.spyOn(test_related_claim, 'with_unit_claim')
			.mockImplementation(async (_files, run) => {
				expect(mocked_create).not.toHaveBeenCalled()

				return await run()
			})

		await test_no_base.run_if_touched(ROOT, [BASE_FILE, OTHER_FILE], [])

		expect(claim).toHaveBeenCalledWith([BASE_FILE], expect.any(Function))
		expect(mocked_run).toHaveBeenCalledOnce()
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

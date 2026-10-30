import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { changed_file_scope } from '#scripts/git/changed-file-scope'
import { execa } from 'execa'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { test_read_recording } from './test-read-recording'
import { test_unit_guard } from './test-unit-guard'
import { unit_share_fixture } from './unit-share-fixture'

vi.mock('execa', () => ({ execa: vi.fn() }))
vi.mock('#scripts/git/changed-file-scope', () => ({
	changed_file_scope: { repository_root_or_cwd: vi.fn() },
}))
// Mocked for the reasons `test-unit-guard.directory.test.ts` gives: the real ones write this
// checkout's read map and unit log.
vi.mock('./test-read-recording', () => ({ test_read_recording: { with_read_recording: vi.fn() } }))
vi.mock('./vitest-failure-summary', () => ({ vitest_failure_summary: { report: vi.fn() } }))

const FILTER = 'run-transcript'
const ctx = { project_directory: '' }

function add_file(relative_path: string): void {
	const file_path = path.join(ctx.project_directory, relative_path)

	mkdirSync(path.dirname(file_path), { recursive: true })
	writeFileSync(file_path, '{}')
}

beforeEach(() => {
	vi.clearAllMocks()
	unit_share_fixture.stub_share(undefined)
	unit_share_fixture.stub_free(undefined)
	unit_share_fixture.stub_claim(undefined)
	ctx.project_directory = mkdtempSync(path.join(tmpdir(), 'unit-guard-update-'))
	add_file(path.join('node_modules', 'vitest', 'package.json'))
	add_file(path.join('src', 'sample.test.ts'))
	vi.mocked(changed_file_scope.repository_root_or_cwd).mockResolvedValue(ctx.project_directory)
	vi.mocked(test_read_recording.with_read_recording).mockImplementation(
		async (_root, _arguments, run) => await run({}),
	)
	vi.mocked(execa).mockResolvedValue({ exitCode: 0 } as unknown as Awaited<
		ReturnType<typeof execa>
	>)
})

afterEach(() => {
	vi.restoreAllMocks()
	rmSync(ctx.project_directory, { recursive: true, force: true })
})

// vitest's `-u [type]` would read the filter as the update type and run the whole suite (#5383).
describe('test_unit_guard.run_guarded_unit — a filter after the update flag', () => {
	it('passes the filter in front of -u and says so', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await expect(
			test_unit_guard.run_guarded_unit(ctx.project_directory, ['-u', FILTER]),
		).resolves.toBe(0)
		expect(execa).toHaveBeenCalledWith(
			'pnpm',
			['exec', 'vitest', 'run', FILTER, '-u'],
			expect.objectContaining({ reject: false }),
		)
		expect(info).toHaveBeenCalledWith(expect.stringContaining(`"${FILTER}"`))
	})

	it('passes an update type through and says nothing', async () => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		await test_unit_guard.run_guarded_unit(ctx.project_directory, ['-u', 'all', FILTER])

		expect(execa).toHaveBeenCalledWith(
			'pnpm',
			['exec', 'vitest', 'run', '-u', 'all', FILTER],
			expect.objectContaining({ reject: false }),
		)
		expect(info).not.toHaveBeenCalled()
	})
})

import { main_entry_fixture } from '#scripts/josh/main-entry-fixture'
import { describe, expect, it, vi } from 'vitest'

const { run, batch_run, is_batch } = vi.hoisted(() => ({
	run: vi.fn(),
	batch_run: vi.fn(),
	is_batch: vi.fn(() => false),
}))

vi.mock('./issue-file-cli', () => ({ issue_file_cli: { run } }))
vi.mock('./issue-file-batch', () => ({ issue_file_batch: { is_batch, run: batch_run } }))

const BATCH_ARGUMENTS: ReadonlyArray<string> = ['--batch', 'deferred']
const BATCH_EXIT_CODE = 4
const ENTRY = 'scripts/issue/issue-file-main.ts'

const CASES = main_entry_fixture.entry_cases({
	command: 'issue:file',
	entry: ENTRY,
	library: 'scripts/issue/issue-file-cli.ts',
	run,
})

describe('issue-file-main', () => {
	it.each(CASES)('%s', async (_name, check) => {
		await check()
	})

	// joshuafolkken/kit#5660
	it('hands a --batch argument list to issue_file_batch.run, not issue_file_cli.run', async () => {
		run.mockReset()
		is_batch.mockReturnValueOnce(true)
		batch_run.mockReturnValue(BATCH_EXIT_CODE)

		expect(await main_entry_fixture.run_entry(ENTRY, BATCH_ARGUMENTS)).toBe(BATCH_EXIT_CODE)
		expect(batch_run).toHaveBeenCalledWith(BATCH_ARGUMENTS)
		expect(run).not.toHaveBeenCalled()
	})
})

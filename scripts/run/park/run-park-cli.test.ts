import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_park_cli } from './run-park-cli'

const { apply_mock, clear_label_mock, record_mock, clear_record_mock } = vi.hoisted(() => ({
	apply_mock:
		vi.fn<
			(
				issue: string,
				label: string,
				body: string,
			) => Promise<{ is_labelled: boolean; is_commented: boolean }>
		>(),
	clear_label_mock: vi.fn<(issue: string, label: string) => Promise<boolean>>(),
	record_mock: vi.fn<(issue: string, directory: string) => boolean>(),
	clear_record_mock: vi.fn<(issue: string, directory: string) => void>(),
}))

vi.mock('#scripts/issue/issue-park', () => ({ issue_park: { apply: apply_mock } }))
vi.mock('#scripts/gh/git-gh-issue-write', () => ({
	git_gh_issue_write: { issue_clear_label: clear_label_mock },
}))
vi.mock('./run-park', () => ({ run_park: { record: record_mock, clear: clear_record_mock } }))

const ISSUE = '4132'
const LABEL = 'needs-decision'
const DIRECTORY = '/lane/4132'
const WORK_DIRECTORY = mkdtempSync(path.join(tmpdir(), 'run-park-cli-'))
const BODY_FILE = path.join(WORK_DIRECTORY, 'park.md')
const QUESTION = 'Which option?'
const BODY = `${QUESTION}\n`
const BODY_FILE_FLAG = '--body-file'
const PARK_ARGV = [ISSUE, BODY_FILE_FLAG, BODY_FILE]

writeFileSync(BODY_FILE, BODY)

beforeEach(() => {
	apply_mock.mockReset().mockResolvedValue({ is_labelled: true, is_commented: true })
	clear_label_mock.mockReset().mockResolvedValue(true)
	record_mock.mockReset().mockReturnValue(true)
	clear_record_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(() => undefined)
	vi.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterAll(() => {
	rmSync(WORK_DIRECTORY, { recursive: true, force: true })
})

// joshuafolkken/kit#4132: one call parks a lane child, and one call takes the park back off.
describe('run:park', () => {
	it('comments, applies needs-decision and records the park', async () => {
		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(0)
		expect(apply_mock).toHaveBeenCalledWith(ISSUE, LABEL, expect.stringContaining(QUESTION))
		expect(record_mock).toHaveBeenCalledWith(ISSUE, DIRECTORY)
	})

	// The guard falls silent on a record, so only a park with both halves on the issue is recorded.
	it.each([
		[{ is_labelled: false, is_commented: false }],
		[{ is_labelled: true, is_commented: false }],
	])('fails and records nothing when the write is %j', async (write) => {
		apply_mock.mockResolvedValue(write)

		await expect(run_park_cli.run(PARK_ARGV, DIRECTORY)).resolves.toBe(1)
		expect(record_mock).not.toHaveBeenCalled()
	})

	it.each([[[ISSUE]], [[BODY_FILE_FLAG, BODY_FILE]], [['abc', BODY_FILE_FLAG, BODY_FILE]]])(
		'refuses %j with the usage',
		async (argv) => {
			await expect(run_park_cli.run(argv, DIRECTORY)).resolves.toBe(1)
			expect(apply_mock).not.toHaveBeenCalled()
			expect(console.error).toHaveBeenCalledWith(run_park_cli.USAGE)
		},
	)
})

describe('run:park --clear', () => {
	it('removes needs-decision and the record', async () => {
		await expect(run_park_cli.run([ISSUE, '--clear'], DIRECTORY)).resolves.toBe(0)
		expect(clear_label_mock).toHaveBeenCalledWith(ISSUE, LABEL)
		expect(clear_record_mock).toHaveBeenCalledWith(ISSUE, DIRECTORY)
	})

	// `issue_clear_label` answers `true` for a label that is already off, so the clear succeeds.
	it('fails when the label is still on, and clears the record anyway', async () => {
		clear_label_mock.mockResolvedValue(false)

		await expect(run_park_cli.run([ISSUE, '--clear'], DIRECTORY)).resolves.toBe(1)
		expect(clear_record_mock).toHaveBeenCalledWith(ISSUE, DIRECTORY)
	})

	it('refuses a clear with no issue', async () => {
		await expect(run_park_cli.run(['--clear'], DIRECTORY)).resolves.toBe(1)
		expect(clear_label_mock).not.toHaveBeenCalled()
	})
})

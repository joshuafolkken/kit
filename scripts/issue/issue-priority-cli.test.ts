import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_priority_cli } from './issue-priority-cli'
import { issue_priority_raise } from './issue-priority-raise'

// joshuafolkken/kit#4960: `josh issue:priority <N>` reports the raise and exits on its result.

vi.mock('./issue-priority-raise', () => ({ issue_priority_raise: { raise: vi.fn() } }))

const ISSUE_NUMBER = '4960'
const mocked_raise = vi.mocked(issue_priority_raise.raise)

beforeEach(() => {
	vi.restoreAllMocks()
	vi.clearAllMocks()
})

describe('issue_priority_cli.run', () => {
	it.each([[[]], [['x']], [[ISSUE_NUMBER, '1']]])('refuses the arguments %j', async (argv) => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		await expect(issue_priority_cli.run(argv)).resolves.toBe(1)
		expect(error).toHaveBeenCalledWith('Usage: josh issue:priority <issue-number>')
		expect(mocked_raise).not.toHaveBeenCalled()
	})

	it.each([
		['raised', 'applied `priority:high`'],
		['labelled', 'already carries a priority label'],
		['below', 'stays below the high floor'],
	] as const)('reports %s and exits 0', async (result, text) => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		mocked_raise.mockResolvedValue(result)

		await expect(issue_priority_cli.run([ISSUE_NUMBER])).resolves.toBe(0)
		expect(mocked_raise).toHaveBeenCalledWith(ISSUE_NUMBER)
		expect(info).toHaveBeenCalledWith(expect.stringContaining(text))
	})

	it.each([
		['unreadable', 'could not be read'],
		['failed', 'applying `priority:high` failed'],
	] as const)('reports %s and exits 1', async (result, text) => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		mocked_raise.mockResolvedValue(result)

		await expect(issue_priority_cli.run([ISSUE_NUMBER])).resolves.toBe(1)
		expect(error).toHaveBeenCalledWith(expect.stringContaining(text))
	})
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_priority_cli } from './issue-priority-cli'
import { issue_priority_instructed } from './issue-priority-instructed'
import { issue_priority_raise } from './issue-priority-raise'

// joshuafolkken/kit#4960: `josh issue:priority <N>` reports the raise and exits on its result.

vi.mock('./issue-priority-raise', async (import_original) => {
	const original: { issue_priority_raise: typeof issue_priority_raise } = await import_original()

	return { issue_priority_raise: { ...original.issue_priority_raise, raise: vi.fn() } }
})

vi.mock('./issue-priority-instructed', () => ({ issue_priority_instructed: { apply: vi.fn() } }))

const ISSUE_NUMBER = '4960'
const CRITICAL = '--critical'
const REASON_FLAG = '--reason'
const REASON = 'the person asked to change it'
const mocked_raise = vi.mocked(issue_priority_raise.raise)
const mocked_instructed = vi.mocked(issue_priority_instructed.apply)

beforeEach(() => {
	vi.restoreAllMocks()
})

describe('issue_priority_cli.run usage', () => {
	it.each([
		[[]],
		[['x']],
		[[ISSUE_NUMBER, '1']],
		[[ISSUE_NUMBER, CRITICAL]],
		[[ISSUE_NUMBER, CRITICAL, REASON_FLAG, ' ']],
		[[ISSUE_NUMBER, REASON_FLAG, REASON]],
		[[ISSUE_NUMBER, CRITICAL, '--high', REASON_FLAG, REASON]],
		[[ISSUE_NUMBER, '--unknown']],
	])('refuses the arguments %j and writes nothing', async (argv) => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		await expect(issue_priority_cli.run(argv)).resolves.toBe(1)
		expect(error).toHaveBeenCalledWith(
			'Usage: josh issue:priority <issue-number> [--critical|--high|--normal --reason <text>]',
		)
		expect(mocked_raise).not.toHaveBeenCalled()
		expect(mocked_instructed).not.toHaveBeenCalled()
	})
})

describe('issue_priority_cli.run --critical', () => {
	it.each([
		['raised', 'info', 0, 'took the instructed priority'],
		['labelled', 'info', 0, 'already carries the instructed priority'],
		['unreadable', 'error', 1, 'the instructed priority not applied'],
		['failed', 'error', 1, 'changing to the instructed priority'],
	] as const)('reports %s on console.%s and exits %d', async (result, stream, code, text) => {
		const print = vi.spyOn(console, stream).mockImplementation(() => undefined)

		mocked_instructed.mockResolvedValue(result)

		await expect(
			issue_priority_cli.run([ISSUE_NUMBER, CRITICAL, REASON_FLAG, REASON]),
		).resolves.toBe(code)
		expect(mocked_instructed).toHaveBeenCalledWith(ISSUE_NUMBER, 'critical', REASON)
		expect(mocked_raise).not.toHaveBeenCalled()
		expect(print).toHaveBeenCalledWith(
			expect.stringMatching(new RegExp(`${text}.*\\(--critical\\)\\.$`, 'u')),
		)
	})
})

describe('issue_priority_cli.run --high and --normal', () => {
	it.each(['high', 'normal'] as const)('passes --%s to the instructed change', async (level) => {
		vi.spyOn(console, 'info').mockImplementation(() => undefined)
		mocked_instructed.mockResolvedValue('raised')

		await expect(
			issue_priority_cli.run([ISSUE_NUMBER, `--${level}`, REASON_FLAG, REASON]),
		).resolves.toBe(0)
		expect(mocked_instructed).toHaveBeenCalledWith(ISSUE_NUMBER, level, REASON)
	})
})

describe('issue_priority_cli.run', () => {
	it.each([
		['raised', 'applied the priority label its body declares'],
		['labelled', 'already carries a priority label'],
		['below', 'stays at normal priority'],
	] as const)('reports %s and exits 0', async (result, text) => {
		const info = vi.spyOn(console, 'info').mockImplementation(() => undefined)

		mocked_raise.mockResolvedValue(result)

		await expect(issue_priority_cli.run([ISSUE_NUMBER])).resolves.toBe(0)
		expect(mocked_raise).toHaveBeenCalledWith(ISSUE_NUMBER)
		expect(info).toHaveBeenCalledWith(expect.stringContaining(text))
	})

	it.each([
		['unreadable', 'could not be read'],
		['failed', 'applying the priority label failed'],
	] as const)('reports %s and exits 1', async (result, text) => {
		const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

		mocked_raise.mockResolvedValue(result)

		await expect(issue_priority_cli.run([ISSUE_NUMBER])).resolves.toBe(1)
		expect(error).toHaveBeenCalledWith(expect.stringContaining(text))
	})
})

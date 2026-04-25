import { describe, expect, it, vi } from 'vitest'

const exec_file_mock = vi.hoisted(() => vi.fn())

vi.mock('node:child_process', () => ({ execFile: exec_file_mock }))
vi.mock('node:util', () => ({
	promisify: (function_: unknown) => function_,
	parseArgs: vi.fn().mockReturnValue({ values: {} }),
}))
vi.mock('../scripts/git/telegram-notify', () => ({
	telegram_notify: { send: vi.fn() },
}))
vi.mock('./environment-loader', () => ({ load_optional_environment: vi.fn() }))
vi.mock('./telegram-test-logic', () => ({
	telegram_test_logic: {
		parse_issue_number: vi.fn(),
		build_input: vi.fn().mockReturnValue({}),
	},
}))

const REPO_RESPONSE = { stdout: 'owner/my-repo\n', stderr: '' }
const ISSUE_TITLE = 'Fix login bug'

const { telegram_test } = await import('./telegram-test')

describe('telegram_test.fetch_repo_name — success', () => {
	it('returns only the repo name part after the slash', async () => {
		exec_file_mock.mockResolvedValue(REPO_RESPONSE)

		const result = await telegram_test.fetch_repo_name()

		expect(result).toBe('my-repo')
	})
})

describe('telegram_test.fetch_repo_name — failure', () => {
	it('returns undefined when gh command throws', async () => {
		exec_file_mock.mockRejectedValue(new Error('not found'))

		const result = await telegram_test.fetch_repo_name()

		expect(result).toBeUndefined()
	})
})

describe('telegram_test.fetch_issue_title — undefined input', () => {
	it('returns undefined without calling gh when issue_number is undefined', async () => {
		exec_file_mock.mockClear()
		const no_issue: string | undefined = undefined

		const result = await telegram_test.fetch_issue_title(no_issue)

		expect(result).toBeUndefined()
		expect(exec_file_mock).not.toHaveBeenCalled()
	})
})

describe('telegram_test.fetch_issue_title — success', () => {
	it('returns trimmed title from gh output', async () => {
		exec_file_mock.mockResolvedValue({ stdout: `${ISSUE_TITLE}\n`, stderr: '' })

		const result = await telegram_test.fetch_issue_title('42')

		expect(result).toBe(ISSUE_TITLE)
	})
})

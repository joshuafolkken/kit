import type { IssueState } from '#scripts/issue/issue-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_next } from './run-next'
import type { PrepParts } from './run-prep'

const parse_number_mock = vi.hoisted(() => vi.fn())
const gather_mock = vi.hoisted(() => vi.fn())
const to_parts_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const error_mock = vi.hoisted(() => vi.fn())

vi.mock('./run-prep-cli', () => ({
	run_prep_cli: { parse_number: parse_number_mock, gather: gather_mock, to_parts: to_parts_mock },
}))

const { run_next_cli } = await import('./run-next-cli')

const SUCCESS = 0
const FAILURE = 1
const ISSUE = '2188'
const OPEN_STATE: IssueState = { state: 'OPEN', labels: [], is_human_review: false }

function parts(overrides: Partial<PrepParts>): PrepParts {
	return {
		issue_number: ISSUE,
		content_body: 'body',
		state: OPEN_STATE,
		state_failure: '',
		latest_scope: 'skip',
		latest_reason: 'window is 12h',
		has_changes: false,
		...overrides,
	}
}

function printed(): string {
	return info_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

beforeEach(() => {
	parse_number_mock.mockReset()
	gather_mock.mockReset()
	to_parts_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
	info_mock.mockReset()
	error_mock.mockReset()
	parse_number_mock.mockReturnValue(ISSUE)
	gather_mock.mockResolvedValue({})
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_next_cli.run', () => {
	it('prints the step the state maps to and exits zero', async () => {
		to_parts_mock.mockReturnValue(parts({}))

		expect(await run_next_cli.run([ISSUE])).toBe(SUCCESS)
		expect(printed()).toBe(run_next.IMPLEMENT_STEP)
	})

	it('reads its state through run:prep’s own gather', async () => {
		to_parts_mock.mockReturnValue(parts({}))

		await run_next_cli.run([ISSUE])

		expect(gather_mock).toHaveBeenCalledWith(ISSUE)
	})

	it('exits non-zero when the state could not be read', async () => {
		to_parts_mock.mockReturnValue(parts({ state: undefined }))

		expect(await run_next_cli.run([ISSUE])).toBe(FAILURE)
		expect(printed()).toBe(run_next.UNKNOWN_STEP)
	})

	it('refuses a missing issue number', async () => {
		parse_number_mock.mockReturnValue(undefined)

		expect(await run_next_cli.run([])).toBe(FAILURE)
		expect(gather_mock).not.toHaveBeenCalled()
	})
})

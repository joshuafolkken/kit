import type { IssueState } from '#scripts/issue/issue-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PrepParts } from './run-prep'
import { run_step } from './run-step'

const parse_number_mock = vi.hoisted(() => vi.fn())
const gather_mock = vi.hoisted(() => vi.fn())
const to_parts_mock = vi.hoisted(() => vi.fn())
const repo_directory_mock = vi.hoisted(() => vi.fn())
const read_carry_mock = vi.hoisted(() => vi.fn())
const read_last_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const error_mock = vi.hoisted(() => vi.fn())

vi.mock('./run-prep-cli', () => ({
	run_prep_cli: { parse_number: parse_number_mock, gather: gather_mock, to_parts: to_parts_mock },
}))

vi.mock('./run-carry', () => ({
	run_carry: {
		repository_directory: repo_directory_mock,
		read_carry: read_carry_mock,
		carry_path: (directory: string) => `${directory}/carry`,
		retrospective_done_of: (read: { carry?: { retrospective?: boolean } }) =>
			read.carry?.retrospective === true,
	},
}))

vi.mock('./run-event-stream', () => ({
	run_event_stream: {
		EVENT_KIND: {
			PLAN: 'plan',
			CHILD_LAUNCH: 'child-launch',
			MERGE: 'merge',
			PARK: 'park',
			OUTAGE: 'outage',
			CUT: 'cut',
			STOP: 'stop',
			PR_OPENED: 'pr-opened',
			REVIEW_ROUND: 'review-round',
		},
		target_of: (directory: string) => `${directory}/events`,
		read_last: read_last_mock,
	},
}))

const { run_step_cli } = await import('./run-step-cli')

const SUCCESS = 0
const FAILURE = 1
const ISSUE = '2248'
const OPEN_STATE: IssueState = { state: 'OPEN', labels: [], is_human_review: false }

function parts(overrides: Partial<PrepParts>): PrepParts {
	return {
		issue_number: ISSUE,
		content_body: 'body',
		state: OPEN_STATE,
		state_failure: '',
		latest_scope: 'skip',
		latest_reason: 'window is 12h',
		...overrides,
	}
}

function printed(): string {
	return info_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
	const mocks = [
		parse_number_mock,
		gather_mock,
		to_parts_mock,
		repo_directory_mock,
		read_carry_mock,
		read_last_mock,
		info_mock,
		error_mock,
	]

	for (const mock of mocks) mock.mockReset()
	parse_number_mock.mockReturnValue(ISSUE)
	gather_mock.mockResolvedValue({})
	to_parts_mock.mockReturnValue(parts({}))
	repo_directory_mock.mockResolvedValue('/repo')
	read_carry_mock.mockReturnValue({ kind: 'none' })
	read_last_mock.mockReturnValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_step_cli.run', () => {
	it('prints the implement verdict for an open issue with an empty stream and exits zero', async () => {
		expect(await run_step_cli.run([ISSUE])).toBe(SUCCESS)
		expect(printed()).toBe(run_step.IMPLEMENT)
	})

	it('reads its issue facts through run:prep’s own gather', async () => {
		await run_step_cli.run([ISSUE])

		expect(gather_mock).toHaveBeenCalledWith(ISSUE)
	})

	it('dispatches to followup when the newest event is a PR opening', async () => {
		read_last_mock.mockReturnValue({ pos: 1, at: 'now', kind: 'pr-opened', text: '' })

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe('pnpm josh followup')
	})

	it('answers unknown when the carry record is unreadable', async () => {
		read_carry_mock.mockReturnValue({ kind: 'unreadable' })

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe(run_step.UNKNOWN)
	})

	it('exits non-zero when the issue state could not be read', async () => {
		to_parts_mock.mockReturnValue(parts({ state: undefined }))

		expect(await run_step_cli.run([ISSUE])).toBe(FAILURE)
		expect(printed()).toBe(run_step.UNKNOWN)
	})

	it('refuses a missing issue number', async () => {
		parse_number_mock.mockReturnValue(undefined)

		expect(await run_step_cli.run([])).toBe(FAILURE)
		expect(gather_mock).not.toHaveBeenCalled()
	})
})

// joshuafolkken/kit#2370: the retrospective is opt-in, so the same stop position prints the
// retrospective command only when `JOSH_RETROSPECTIVE` is set to an enabling value.
describe('run_step_cli.run — the JOSH_RETROSPECTIVE switch', () => {
	beforeEach(() => {
		read_last_mock.mockReturnValue({ pos: 1, at: 'now', kind: 'stop', text: '' })
	})

	afterEach(() => {
		delete process.env['JOSH_RETROSPECTIVE']
	})

	it('stops with no command at a stop when the switch is unset', async () => {
		delete process.env['JOSH_RETROSPECTIVE']

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe(run_step.STOP)
	})

	it('dispatches the retrospective at a stop when the switch is enabled', async () => {
		process.env['JOSH_RETROSPECTIVE'] = 'on'

		await run_step_cli.run([ISSUE])

		expect(printed()).toBe(run_step.RETROSPECTIVE_COMMAND)
	})
})

import { readFileSync } from 'node:fs'
import type { IssueState } from '#scripts/issue/issue-state'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_prep } from './run-prep'

const read_block_mock = vi.hoisted(() => vi.fn())
const read_state_mock = vi.hoisted(() => vi.fn())
const decide_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const error_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-read-cli', () => ({
	issue_read_cli: { read_block: read_block_mock },
}))

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_state_mock },
}))

vi.mock('#scripts/version/latest-scope-cli', () => ({
	latest_scope_cli: { decide: decide_mock },
}))

const { run_prep_cli } = await import('./run-prep-cli')

const SUCCESS = 0
const FAILURE = 1
const ISSUE = '1978'
const OTHER_ISSUE = '1979'
const BLOCK = 'issue: 1978\nThe body\n\ncomment by alice: agreed'
const OPEN_STATE: IssueState = { state: 'OPEN', labels: ['auto-ok'], is_human_review: false }
const SKIP_DECISION = { scope: 'skip', reason: 'ran 2 hours ago; window is 12h' }
const REVIEW_STATE: IssueState = {
	state: 'OPEN',
	labels: ['needs-human-review'],
	is_human_review: true,
}

function printed(): string {
	return info_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

function reported(): string {
	return error_mock.mock.calls.map((call) => String(call[0])).join('\n')
}

function stub_ok(): void {
	read_block_mock.mockResolvedValue({ kind: 'ok', block: BLOCK })
	read_state_mock.mockResolvedValue({ kind: 'state', state: OPEN_STATE })
}

beforeEach(() => {
	read_block_mock.mockReset()
	read_state_mock.mockReset()
	decide_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
	info_mock.mockReset()
	error_mock.mockReset()
	decide_mock.mockReturnValue(SKIP_DECISION)
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('run_prep_cli.parse_number', () => {
	it('reads a single issue number', () => {
		expect(run_prep_cli.parse_number([ISSUE])).toBe(ISSUE)
	})

	it('refuses a second number', () => {
		expect(run_prep_cli.parse_number([ISSUE, OTHER_ISSUE])).toBeUndefined()
	})

	it('refuses a token that is not a number', () => {
		expect(run_prep_cli.parse_number(['#1978'])).toBeUndefined()
	})
})

describe('run_prep_cli.run', () => {
	it('bundles the body, state and dependency scope into one report', async () => {
		stub_ok()

		expect(await run_prep_cli.run([ISSUE])).toBe(SUCCESS)

		const out = printed()
		const expected = [
			`${run_prep.SUMMARY_PREFIX}${ISSUE}`,
			'human_review: no',
			run_prep.CONTENT_HEADER,
			BLOCK,
			run_prep.STATE_HEADER,
			'labels: auto-ok',
			run_prep.LATEST_HEADER,
			'skip',
		]

		expect(expected.every((part) => out.includes(part))).toBe(true)
	})

	it('reads all three parts in one invocation', async () => {
		stub_ok()

		await run_prep_cli.run([ISSUE])

		expect(read_block_mock).toHaveBeenCalledTimes(1)
		expect(read_state_mock).toHaveBeenCalledTimes(1)
		expect(decide_mock).toHaveBeenCalledTimes(1)
	})

	it('exits non-zero and notes a failed read without printing an empty state', async () => {
		read_block_mock.mockResolvedValue({ kind: 'missing' })
		read_state_mock.mockResolvedValue({ kind: 'unreadable' })

		expect(await run_prep_cli.run([ISSUE])).toBe(FAILURE)
		expect(printed()).toContain('not bundled')
	})

	it('refuses no argument', async () => {
		expect(await run_prep_cli.run([])).toBe(FAILURE)
		expect(reported()).toContain('Usage')
	})
})

describe('run_prep.format_report', () => {
	it('surfaces a human-review issue on the summary line', () => {
		const report = run_prep.format_report({
			issue_number: ISSUE,
			content_body: BLOCK,
			state: REVIEW_STATE,
			state_failure: '',
			latest_scope: 'required',
			latest_reason: 'last update 20h ago',
		})

		expect(report.split('\n', 1)[0]).toContain('human_review: yes')
		expect(report).toContain('latest: required')
	})
})

describe('josh run:prep registration', () => {
	it('is registered as a josh command', () => {
		const source = readFileSync('scripts/josh/josh-commands-ai.ts', 'utf8')

		expect(source).toContain("'run:prep'")
		expect(source).toContain('scripts/run/run-prep-cli.ts')
	})

	it('has the rp alias', () => {
		const source = readFileSync('scripts/josh/josh-command-map.ts', 'utf8')

		expect(source).toContain("rp: 'run:prep'")
	})
})

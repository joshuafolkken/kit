import type { IssueState } from '#scripts/issue/issue-state'
import { session_cite } from '#scripts/issue/session-cite'
import { COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { run_prep } from './run-prep'

const read_block_mock = vi.hoisted(() => vi.fn())
const read_state_mock = vi.hoisted(() => vi.fn())
const decide_mock = vi.hoisted(() => vi.fn())
const is_child_mock = vi.hoisted(() => vi.fn())
const info_mock = vi.hoisted(() => vi.fn())
const error_mock = vi.hoisted(() => vi.fn())
const locate_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/issue/issue-read-cli', () => ({
	issue_read_cli: { read_block: read_block_mock },
}))

vi.mock('#scripts/issue/issue-state-cli', () => ({
	issue_state_cli: { read_issue: read_state_mock },
}))

vi.mock('#scripts/version/latest-scope-cli', () => ({
	latest_scope_cli: { decide: decide_mock },
}))

vi.mock('./run-prep-locate', () => ({
	run_prep_locate: { locate: locate_mock },
}))

vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: is_child_mock },
}))

const has_changes_mock = vi.hoisted(() => vi.fn())

vi.mock('#scripts/git/stash/git-stash', () => ({
	git_stash: { has_changes: has_changes_mock },
}))

const ahead_mock = vi.hoisted(() => vi.fn<(issue_number: string) => Promise<Array<string>>>())

vi.mock('#scripts/run/ship/run-ship-preflight', () => ({
	run_ship_preflight: { ahead: ahead_mock },
}))

const { run_prep_cli } = await import('./run-prep-cli')

const SUCCESS = 0
const FAILURE = 1
const ISSUE = '1978'
const OTHER_ISSUE = '1979'
const BLOCK = 'issue: 1978\nThe body\n\ncomment by alice: agreed'
const OPEN_STATE: IssueState = { state: 'OPEN', labels: ['auto-ok'], is_human_review: false }
const SKIP_DECISION = { scope: 'skip', reason: 'ran 2 hours ago; window is 12h' }
const LOCATIONS = 'run:prep\n  scripts/josh/josh-commands-ai.ts:42  run:prep'
const CLASSIFICATION_PROBLEM = 'Add "- リリース分類: <label>" to the Issue body.'
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
	is_child_mock.mockReset()
	vi.spyOn(console, 'info').mockImplementation(info_mock)
	vi.spyOn(console, 'error').mockImplementation(error_mock)
	info_mock.mockReset()
	error_mock.mockReset()
	decide_mock.mockReturnValue(SKIP_DECISION)
	is_child_mock.mockReturnValue(false)
})

beforeEach(() => {
	locate_mock.mockReset()
	locate_mock.mockResolvedValue(LOCATIONS)
	ahead_mock.mockReset().mockResolvedValue([])
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
			session_cite.text(`${run_prep.SUMMARY_PREFIX}${ISSUE}`),
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

// joshuafolkken/kit#2761: the code locations the body names are bundled as their own section.
describe('run_prep_cli.run code locations', () => {
	it('locates the names from the body it read and prints them as their own section', async () => {
		stub_ok()

		await run_prep_cli.run([ISSUE])

		expect(locate_mock).toHaveBeenCalledWith(BLOCK)
		expect(printed()).toContain(`${run_prep.LOCATIONS_HEADER}\n${LOCATIONS}`)
	})

	it('locates nothing from a body that could not be read', async () => {
		read_block_mock.mockResolvedValue({ kind: 'missing' })
		read_state_mock.mockResolvedValue({ kind: 'state', state: OPEN_STATE })

		await run_prep_cli.run([ISSUE])

		expect(locate_mock).toHaveBeenCalledWith('')
	})
})

describe('run_prep_cli.run dependency scope', () => {
	it('skips the dependency scope inside a dispatched lane child', async () => {
		stub_ok()
		is_child_mock.mockReturnValue(true)

		expect(await run_prep_cli.run([ISSUE])).toBe(SUCCESS)

		expect(decide_mock).not.toHaveBeenCalled()
		expect(printed()).toContain('latest: not asked')
	})

	it('computes the dependency scope outside a lane child', async () => {
		stub_ok()
		is_child_mock.mockReturnValue(false)

		expect(await run_prep_cli.run([ISSUE])).toBe(SUCCESS)

		expect(decide_mock).toHaveBeenCalledTimes(1)
		expect(printed()).toContain('latest: skip')
	})
})

// joshuafolkken/kit#2476: only a lane child's tree is asked for uncommitted work — a person's own
// checkout keeps its unrelated edits out of the verdict.
describe('run_prep_cli.gather — uncommitted work', () => {
	beforeEach(() => {
		has_changes_mock.mockReset()
	})

	it('reads the tree of a dispatched lane child', async () => {
		stub_ok()
		is_child_mock.mockReturnValue(true)
		has_changes_mock.mockResolvedValue(true)

		const reads = await run_prep_cli.gather(ISSUE)

		expect(run_prep_cli.to_parts(ISSUE, reads).has_changes).toBe(true)
	})

	it('never reads a checkout that is not a lane', async () => {
		stub_ok()
		has_changes_mock.mockResolvedValue(true)

		const reads = await run_prep_cli.gather(ISSUE)

		expect(reads.has_changes).toBe(false)
		expect(has_changes_mock).not.toHaveBeenCalled()
	})

	it('reports no changes when the lane status cannot be read', async () => {
		stub_ok()
		is_child_mock.mockReturnValue(true)
		has_changes_mock.mockRejectedValue(new Error('not a git repository'))

		const reads = await run_prep_cli.gather(ISSUE)

		expect(reads.has_changes).toBe(false)
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
			has_changes: false,
			locations: '',
			ship_problems: [],
		})

		expect(report.split('\n', 1)[0]).toContain('human_review: yes')
		expect(report).toContain('latest: required')
	})
})

// joshuafolkken/kit#3154: what `josh ship` would refuse on is reported at the entry, not at the ship.
describe('run_prep_cli.run ship preconditions', () => {
	it('reports the unmet classification as its own section', async () => {
		stub_ok()
		ahead_mock.mockResolvedValue([CLASSIFICATION_PROBLEM])

		await run_prep_cli.run([ISSUE])

		const out = printed()

		expect(out).toContain(run_prep.SHIP_HEADER)
		expect(out).toContain(run_prep.SHIP_UNMET)
		expect(out).toContain(CLASSIFICATION_PROBLEM)
		expect(ahead_mock).toHaveBeenCalledWith(ISSUE)
	})

	it('says the preconditions are met when nothing would be refused', async () => {
		stub_ok()

		await run_prep_cli.run([ISSUE])

		expect(printed()).toContain(run_prep.SHIP_HEADER)
		expect(printed()).not.toContain(run_prep.SHIP_UNMET)
	})
})

describe('josh run:prep registration', () => {
	it('is registered as a josh command', () => {
		expect(COMMAND_MAP['run:prep']?.script).toBe('scripts/run/run-prep-cli.ts')
	})
})

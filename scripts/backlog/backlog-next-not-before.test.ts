import {
	auto_ok_fixture,
	CREATED_EARLIER,
	OLD_ISSUE_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_issue_write } from '#scripts/gh/git-gh-issue-write'
import type { OpenIssueData } from '#scripts/git/git-schemas'
import { PRIORITY_CRITICAL_LABEL } from '#scripts/issue/issue-labels'
import { issue_sample_gate } from '#scripts/issue/issue-sample-gate'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'
import { backlog_pool } from './backlog-pool'

// joshuafolkken/kit#4007: a follow-up measurement declares the earliest time it can start, and
// `backlog:next` holds it on the time side until then, saying why.

const { issue, console_streams } = auto_ok_fixture

const FUTURE = '2999-01-01T00:00Z'
const PAST = '2000-01-01T00:00Z'
const READING_REPO = 'joshuafolkken/kit'
const NOT_BEFORE = 'not-before'
const OTHER_ISSUE_NUMBER = 9001
const MEASURED_PR = 4313

const streams = console_streams()
const { stdout, stderr } = streams

function declaring(date: string): string {
	return `## 背景\n\n- 実施可能日: ${date}\n`
}

function dated(date: string): OpenIssueData {
	return { ...issue(OLD_ISSUE_NUMBER, CREATED_EARLIER), body: declaring(date) }
}

function classify(row: OpenIssueData): ReturnType<typeof backlog_pool.classify_standalone> {
	return backlog_pool.classify_standalone([row], {
		tracked: new Map<number, number>(),
		exclude: [],
		repo: READING_REPO,
		running: new Set<string>(),
	})
}

beforeEach(() => {
	vi.restoreAllMocks()
	issue_sample_gate.reset()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	vi.spyOn(git_gh_issue_write, 'label_ensure').mockResolvedValue()
	vi.spyOn(git_gh_issue_write, 'issue_add_label').mockResolvedValue(true)
	vi.spyOn(git_gh_issue_write, 'issue_remove_label').mockResolvedValue()
	streams.reset()
})

describe('backlog_pool.classify_standalone with a declared start time', () => {
	it('holds a row before its time on the time side', () => {
		const result = classify(dated(FUTURE))

		expect(result.runnable).toEqual([])
		expect(result.time.map((child) => child.number)).toEqual([OLD_ISSUE_NUMBER])
	})

	it('offers the same row once its time has passed', () => {
		expect(classify(dated(PAST)).runnable.map((child) => child.number)).toEqual([OLD_ISSUE_NUMBER])
	})
})

describe('backlog:next with a declared start time', () => {
	it('waits and names the time it waits for', async () => {
		backlog_fixture.stub_backlog({ opted_in: [dated(FUTURE)] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.wait)
		expect(stderr()).toContain(`not before ${FUTURE}`)
	})

	// joshuafolkken/kit#4513: the wait names its cause in the line `backlog:offer` reads back.
	it('names the row as waiting on a start condition', async () => {
		backlog_fixture.stub_backlog({ opted_in: [dated(FUTURE)] })

		await backlog_next.run([])

		expect(stderr()).toContain(`Waiting on a start condition: [#${String(OLD_ISSUE_NUMBER)}]`)
	})

	// joshuafolkken/kit#4383: priority:critical ranks the runnable rows, never a row held on time.
	it('still waits on a priority:critical issue before its time', async () => {
		const critical = { ...dated(FUTURE), labels: [{ name: PRIORITY_CRITICAL_LABEL }] }

		backlog_fixture.stub_backlog({ opted_in: [critical] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.wait)
	})

	it('offers the issue once the time has passed', async () => {
		backlog_fixture.stub_backlog({ opted_in: [dated(PAST)] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).not.toContain('not before')
	})
})

// joshuafolkken/kit#4414: a sample condition names its pull request, so the reason is linkified.
describe('backlog:next with a declared sample condition', () => {
	const sampled: OpenIssueData = {
		...issue(OLD_ISSUE_NUMBER, CREATED_EARLIER),
		body: `## 背景\n\n- 実施可能条件: #${String(MEASURED_PR)} のマージ後 3 マージ\n`,
	}

	beforeEach(() => {
		backlog_fixture.stub_backlog({ opted_in: [sampled] })
		vi.spyOn(issue_sample_gate, 'prime').mockResolvedValue()
	})

	it('waits and links the pull request it waits on', async () => {
		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.wait)
		expect(stderr()).toContain(`until the merge of [#${String(MEASURED_PR)}](`)
	})

	it('labels the issue not-before while it waits', async () => {
		await backlog_next.run([])

		expect(git_gh_issue_write.issue_add_label).toHaveBeenCalledWith(
			String(OLD_ISSUE_NUMBER),
			NOT_BEFORE,
		)
	})
})

// joshuafolkken/kit#4079: the scan keeps `not-before` in line with each body it reads.
describe('backlog:next keeps the not-before label in line', () => {
	it('labels an issue whose time is ahead', async () => {
		backlog_fixture.stub_backlog({ opted_in: [dated(FUTURE)] })
		await backlog_next.run([])

		expect(git_gh_issue_write.issue_add_label).toHaveBeenCalledWith(
			String(OLD_ISSUE_NUMBER),
			NOT_BEFORE,
		)
	})

	it('takes the label off an issue whose time has passed', async () => {
		backlog_fixture.stub_backlog({ opted_in: [{ ...dated(PAST), labels: [{ name: NOT_BEFORE }] }] })
		await backlog_next.run([])

		expect(git_gh_issue_write.issue_remove_label).toHaveBeenCalledWith(
			String(OLD_ISSUE_NUMBER),
			NOT_BEFORE,
		)
	})
})

describe('backlog:next sweeps issues only the not-before listing returns', () => {
	it('takes the label off an issue never opted in', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [dated(FUTURE)],
			not_before: [{ number: OTHER_ISSUE_NUMBER, body: declaring(PAST) }],
		})
		await backlog_next.run([])

		expect(git_gh_issue_write.issue_remove_label).toHaveBeenCalledWith(
			String(OTHER_ISSUE_NUMBER),
			NOT_BEFORE,
		)
	})

	it('takes a passed label off with nothing opted in', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [],
			not_before: [{ number: OTHER_ISSUE_NUMBER, body: declaring(PAST) }],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(git_gh_issue_write.issue_remove_label).toHaveBeenCalledWith(
			String(OTHER_ISSUE_NUMBER),
			NOT_BEFORE,
		)
	})
})

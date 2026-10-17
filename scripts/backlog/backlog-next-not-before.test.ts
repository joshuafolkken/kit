import {
	auto_ok_fixture,
	CREATED_EARLIER,
	OLD_ISSUE_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import type { OpenIssueData } from '#scripts/git/git-schemas'
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

const streams = console_streams()
const { stdout, stderr } = streams

function dated(date: string): OpenIssueData {
	return { ...issue(OLD_ISSUE_NUMBER, CREATED_EARLIER), body: `## 背景\n\n- 実施可能日: ${date}\n` }
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
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
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

	it('offers the issue once the time has passed', async () => {
		backlog_fixture.stub_backlog({ opted_in: [dated(PAST)] })

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(OLD_ISSUE_NUMBER))
		expect(stderr()).not.toContain('not before')
	})
})

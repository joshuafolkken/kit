import {
	auto_ok_fixture,
	CREATED_EARLIER,
	CREATED_LATER,
	EPIC_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { RUN_LANE_LABEL, RUN_SOLO_LABEL } from '#scripts/git/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'

// The triage gate end to end through `josh backlog:next` (joshuafolkken/kit#2779): a candidate with
// neither `run:solo` nor `run:lane` withholds every candidate and answers `triage`.

const { issue, console_streams, opted_in_epic } = auto_ok_fixture

const CHILD = 901
const SECOND_CHILD = 902
const STANDALONE = 960

const streams = console_streams()
const { stdout, stderr } = streams

function backlog_with(
	first: ReadonlyArray<string>,
	second: ReadonlyArray<string>,
	untriaged: ReadonlyArray<number>,
): void {
	backlog_fixture.stub_backlog({
		opted_in: [opted_in_epic(), issue(STANDALONE, CREATED_LATER)],
		epics: [{ number: EPIC_NUMBER, children: [CHILD, SECOND_CHILD] }],
		children: [
			{ number: CHILD, labels: first },
			{ number: SECOND_CHILD, labels: second },
		],
		untriaged,
	})
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	streams.reset()
})

describe('backlog:next with an untriaged candidate', () => {
	it('answers triage alone and names the untriaged child on standard error', async () => {
		backlog_with([], [RUN_LANE_LABEL], [CHILD])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.triage)
		expect(stderr()).toContain(`issues/${String(CHILD)}`)
		expect(stderr()).not.toContain(`issues/${String(SECOND_CHILD)})`)
	})

	it('withholds the triaged candidates too, a standalone row included', async () => {
		backlog_with([RUN_LANE_LABEL], [RUN_LANE_LABEL], [STANDALONE])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.triage)
		expect(stderr()).toContain(`issues/${String(STANDALONE)}`)
	})

	it('offers the candidates once each carries run:solo or run:lane, whatever the casing', async () => {
		backlog_with(['Run:Lane'], [RUN_LANE_LABEL], [CHILD, SECOND_CHILD])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(`${String(CHILD)}\n${String(SECOND_CHILD)}\n${String(STANDALONE)}`)
	})

	it('offers a run:solo candidate as before', async () => {
		backlog_with([RUN_SOLO_LABEL], [RUN_LANE_LABEL], [])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(CHILD))
	})

	it('ignores an untriaged issue that is not a candidate yet', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic(), issue(STANDALONE, CREATED_EARLIER)],
			epics: [{ number: EPIC_NUMBER, children: [CHILD, SECOND_CHILD] }],
			children: [{ number: CHILD }, { number: SECOND_CHILD, blocked_by: [CHILD] }],
			untriaged: [SECOND_CHILD],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(`${String(CHILD)}\n${String(STANDALONE)}`)
	})
})

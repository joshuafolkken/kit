import {
	auto_ok_fixture,
	CREATED_EARLIER,
	CREATED_LATER,
	EPIC_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { IN_PROGRESS_LABEL, RUN_LANE_LABEL, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'

// The triage gate end to end through `josh backlog:next` (joshuafolkken/kit#2779, #5518): a candidate
// with neither `run:solo` nor `run:lane` is held alone — the triaged candidates are offered and a
// trailing `triage` asks for its judgment; with none triaged the answer is `triage` alone.

const { issue, console_streams, opted_in_epic } = auto_ok_fixture

const CHILD = 901
const SECOND_CHILD = 902
const STANDALONE = 960
const RUNNING = 950

const streams = console_streams()
const { stdout, stderr } = streams
const { triage } = backlog_next.VERDICT_TOKENS

function backlog_with(
	first: ReadonlyArray<string>,
	second: ReadonlyArray<string>,
	untriaged: ReadonlyArray<number>,
	in_progress: ReadonlyArray<number> = [],
): void {
	backlog_fixture.stub_backlog({
		opted_in: [opted_in_epic(), issue(STANDALONE, CREATED_LATER)],
		epics: [{ number: EPIC_NUMBER, children: [CHILD, SECOND_CHILD] }],
		children: [
			{ number: CHILD, labels: first },
			{ number: SECOND_CHILD, labels: second },
		],
		in_progress: in_progress.map((number) =>
			issue(number, CREATED_EARLIER, [IN_PROGRESS_LABEL, RUN_LANE_LABEL]),
		),
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
	it('offers the triaged candidates, then triage, holding the untriaged child alone', async () => {
		backlog_with([], [RUN_LANE_LABEL], [CHILD])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(`${String(SECOND_CHILD)}\n${String(STANDALONE)}\n${triage}`)
		expect(stderr()).toContain(`Held: [#${String(CHILD)}]`)
	})

	it('holds an untriaged standalone row alone too', async () => {
		backlog_with([RUN_LANE_LABEL], [RUN_LANE_LABEL], [STANDALONE])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(`${String(CHILD)}\n${String(SECOND_CHILD)}\n${triage}`)
		expect(stderr()).toContain(`issues/${String(STANDALONE)}`)
	})

	it('answers triage alone when every candidate is untriaged', async () => {
		backlog_with([], [], [CHILD, SECOND_CHILD, STANDALONE])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(triage)
		expect(stderr()).toContain('Untriaged:')
	})
})

describe('backlog:next once a held candidate is judged', () => {
	it('stops the offer once the held child is judged run:solo beside a running lane', async () => {
		backlog_with([], [RUN_LANE_LABEL], [CHILD, STANDALONE], [RUNNING])
		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(`${String(SECOND_CHILD)}\n${triage}`)

		streams.reset()
		backlog_with([RUN_SOLO_LABEL], [RUN_LANE_LABEL], [STANDALONE], [RUNNING])
		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(triage)
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

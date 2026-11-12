import {
	auto_ok_fixture,
	CREATED_EARLIER,
	CREATED_LATER,
	EPIC_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import { git_gh_command } from '#scripts/gh/git-gh-command'
import { IN_PROGRESS_LABEL, RUN_LANE_LABEL, RUN_SOLO_LABEL } from '#scripts/issue/issue-labels'
import type { OfferRecord } from '#scripts/lane/lane-ledger-schema-offer'
import { lane_ledger_write } from '#scripts/lane/lane-ledger-write'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'

// joshuafolkken/kit#7306: every `backlog:next` answer writes one `offer` line to the lane ledger —
// its verdict, the opted-in issues it read, what it offered, what it held back and why, and whether
// the listing answered 304.

const { issue, console_streams, opted_in_epic } = auto_ok_fixture

const CHILD = 901
const SECOND_CHILD = 902
const STANDALONE = 960
const OTHER_STANDALONE = 961

const streams = console_streams()

function recorded(): Array<OfferRecord> {
	return vi.mocked(lane_ledger_write.record_offer).mock.calls.map(([offer]) => offer)
}

function epic_backlog(labels: ReadonlyArray<string>, untriaged: ReadonlyArray<number> = []): void {
	backlog_fixture.stub_backlog({
		opted_in: [opted_in_epic()],
		epics: [{ number: EPIC_NUMBER, children: [CHILD] }],
		children: [{ number: CHILD, labels }],
		untriaged,
	})
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	vi.spyOn(console, 'warn').mockImplementation(streams.error)
	vi.spyOn(lane_ledger_write, 'record_offer').mockResolvedValue()
	streams.reset()
})

describe('backlog:next — the offer record', () => {
	it('records a run with the issues it offered and the one excluded', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [issue(STANDALONE, CREATED_LATER), issue(OTHER_STANDALONE, CREATED_EARLIER)],
		})

		expect(await backlog_next.run(['--exclude', String(OTHER_STANDALONE)])).toBe(SUCCESS_EXIT_CODE)
		expect(recorded()).toStrictEqual([
			{
				verdict: 'run',
				seen: [STANDALONE, OTHER_STANDALONE],
				started: [STANDALONE],
				excluded: [{ issue: OTHER_STANDALONE, reason: 'exclude' }],
				is_unchanged: false,
			},
		])
	})

	it('records solo for a child the run:solo gate withheld', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [CHILD, SECOND_CHILD] }],
			children: [
				{ number: CHILD, labels: [RUN_SOLO_LABEL] },
				{ number: SECOND_CHILD, labels: [] },
			],
		})

		await backlog_next.run([])

		expect(recorded()).toMatchObject([
			{ verdict: 'run', started: [CHILD], excluded: [{ issue: SECOND_CHILD, reason: 'solo' }] },
		])
	})
})

describe('backlog:next — the offer record beside an untriaged candidate', () => {
	it('records triage with the untriaged candidates held back', async () => {
		epic_backlog([], [CHILD])

		await backlog_next.run([])

		expect(recorded()).toMatchObject([
			{ verdict: 'triage', started: [], excluded: [{ issue: CHILD, reason: 'triage' }] },
		])
	})

	it('records a run beside triage when a triaged candidate is still offered', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic(), issue(STANDALONE, CREATED_LATER)],
			epics: [{ number: EPIC_NUMBER, children: [CHILD, SECOND_CHILD] }],
			children: [
				{ number: CHILD, labels: [] },
				{ number: SECOND_CHILD, labels: [RUN_LANE_LABEL] },
			],
			untriaged: [CHILD],
		})

		await backlog_next.run([])

		expect(recorded()).toMatchObject([
			{
				verdict: 'run',
				started: [SECOND_CHILD, STANDALONE],
				excluded: [{ issue: CHILD, reason: 'triage' }],
			},
		])
	})
})

describe('backlog:next — the offer record of an answer that starts nothing', () => {
	// `wait` is the token `backlog:offer` reads as its `watch`.
	it('records wait with the in-progress child it waited on', async () => {
		epic_backlog([IN_PROGRESS_LABEL])

		await backlog_next.run([])

		expect(recorded()).toMatchObject([
			{ verdict: 'wait', seen: [EPIC_NUMBER], excluded: [{ issue: CHILD, reason: 'wait' }] },
		])
	})

	it('records none for a backlog nobody opted into', async () => {
		backlog_fixture.stub_backlog({ opted_in: [] })

		await backlog_next.run([])

		expect(recorded()).toStrictEqual([
			{ verdict: 'none', seen: [], started: [], excluded: [], is_unchanged: false },
		])
	})

	it('records a listing every page of which answered 304', async () => {
		backlog_fixture.stub_backlog({ opted_in: [issue(STANDALONE, CREATED_LATER)] })
		const listing = await git_gh_command.issue_list_by_label_summary('auto-ok', 1)

		vi.mocked(git_gh_command.issue_list_by_label_summary).mockResolvedValue({
			...listing,
			is_unchanged: true,
		})

		await backlog_next.run([])

		expect(recorded()).toMatchObject([{ verdict: 'run', is_unchanged: true }])
	})
})

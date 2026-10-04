import {
	auto_ok_fixture,
	CREATED_EARLIER,
	EPIC_NUMBER,
	SUCCESS_EXIT_CODE,
} from '#scripts/auto-ok/auto-ok-fixture'
import {
	AUTO_OK_LABEL,
	BUG_LABEL,
	IN_PROGRESS_LABEL,
	RUN_SOLO_LABEL,
} from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'

// The `run:solo` gate end to end through `josh backlog:next` (joshuafolkken/kit#2776): the stdout
// tokens `backlog:offer` and `backlog:drive` read are what enforce it.

const { issue, console_streams, opted_in_epic } = auto_ok_fixture

const CHILD = 901
const SECOND_CHILD = 902
const HOLDER = 950

const streams = console_streams()
const { stdout, stderr } = streams

function epic_with(
	first: ReadonlyArray<string>,
	in_progress: ReadonlyArray<string> = [],
	second: ReadonlyArray<string> = [],
): void {
	backlog_fixture.stub_backlog({
		opted_in: [opted_in_epic()],
		epics: [{ number: EPIC_NUMBER, children: [CHILD, SECOND_CHILD] }],
		children: [
			{ number: CHILD, labels: first },
			{ number: SECOND_CHILD, labels: second },
		],
		in_progress:
			in_progress.length === 0
				? []
				: [issue(HOLDER, CREATED_EARLIER, [IN_PROGRESS_LABEL, ...in_progress])],
	})
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	streams.reset()
})

describe('backlog:next with run:solo', () => {
	it('prints both children when neither carries run:solo', async () => {
		epic_with([])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(`${String(CHILD)}\n${String(SECOND_CHILD)}`)
	})

	it('prints only the run:solo child when the repository is idle', async () => {
		epic_with([RUN_SOLO_LABEL])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(CHILD))
	})

	// joshuafolkken/kit#2928: run:solo alone means "runs alone", not "runs first".
	it('prints the children ahead of a later run:solo child that is not a defect when the repository is idle', async () => {
		epic_with([], [], [RUN_SOLO_LABEL])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(CHILD))
	})

	it('prints a later run:solo defect alone, ranked first, when the repository is idle', async () => {
		epic_with([], [], [BUG_LABEL, RUN_SOLO_LABEL])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(SECOND_CHILD))
	})
})

describe('backlog:next with run:solo while a lane runs', () => {
	it('prints only the children ahead of a later run:solo child while another issue holds a lane', async () => {
		epic_with([], [AUTO_OK_LABEL], [RUN_SOLO_LABEL])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(CHILD))
	})

	it('prints wait for a run:solo child while another issue holds a lane', async () => {
		epic_with([RUN_SOLO_LABEL], [AUTO_OK_LABEL])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.wait)
		expect(stderr()).toContain(RUN_SOLO_LABEL)
	})

	it('prints wait while a run:solo issue is running', async () => {
		epic_with([], [RUN_SOLO_LABEL])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.wait)
	})

	// joshuafolkken/kit#3017: a stale `in-progress` on a run:solo issue drained the whole backlog.
	it('offers the children and names a run:solo holder no process is running for', async () => {
		backlog_fixture.stub_backlog({
			opted_in: [opted_in_epic()],
			epics: [{ number: EPIC_NUMBER, children: [CHILD, SECOND_CHILD] }],
			children: [{ number: CHILD }, { number: SECOND_CHILD }],
			in_progress: [issue(HOLDER, CREATED_EARLIER, [IN_PROGRESS_LABEL, RUN_SOLO_LABEL])],
			stale: [HOLDER],
		})

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(`${String(CHILD)}\n${String(SECOND_CHILD)}`)
		expect(stderr()).toContain(`#${String(HOLDER)}`)
		expect(stderr()).toContain('stale')
	})
})

import { auto_ok_fixture, EPIC_NUMBER, SUCCESS_EXIT_CODE } from '#scripts/auto-ok/auto-ok-fixture'
import { RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_fixture, type ChildInput } from './backlog-fixture'
import { backlog_next } from './backlog-next'

// joshuafolkken/kit#4633: an unattended run takes an epic child's body as its specification exactly
// as it does a standalone row's, and the `auto-ok` on the epic says nothing about a body its author
// rewrote after the label. So a child whose author lacks write access is never offered — it waits on
// a person, and is named as such rather than dropped.

const { console_streams, opted_in_epic } = auto_ok_fixture

const CHILD = 901
const SECOND_CHILD = 902
const OUTSIDER = 'NONE'

const streams = console_streams()
const { stdout, stderr } = streams

function backlog_with(children: ReadonlyArray<ChildInput>): void {
	backlog_fixture.stub_backlog({
		opted_in: [opted_in_epic()],
		epics: [{ number: EPIC_NUMBER, children: children.map((child) => child.number) }],
		children,
	})
}

beforeEach(() => {
	vi.restoreAllMocks()
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
	streams.reset()
})

describe('backlog:next — an epic child whose author lacks write access', () => {
	it('is not offered, and is named as waiting on a person', async () => {
		backlog_with([{ number: CHILD, labels: [RUN_LANE_LABEL], author_association: OUTSIDER }])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(backlog_next.VERDICT_TOKENS.stop)
		expect(stderr()).toContain('Waiting on a person')
		expect(stderr()).toContain(`issues/${String(CHILD)}`)
	})

	it('leaves a sibling the owner filed offered', async () => {
		backlog_with([
			{ number: CHILD, labels: [RUN_LANE_LABEL], author_association: OUTSIDER },
			{ number: SECOND_CHILD, labels: [RUN_LANE_LABEL] },
		])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(SECOND_CHILD))
	})

	it('still offers a child the owner filed', async () => {
		backlog_with([{ number: CHILD, labels: [RUN_LANE_LABEL] }])

		expect(await backlog_next.run([])).toBe(SUCCESS_EXIT_CODE)
		expect(stdout()).toBe(String(CHILD))
	})
})

import { auto_ok_fixture, CREATED_EARLIER, EPIC_NUMBER } from '#scripts/auto-ok/auto-ok-fixture'
import { NEEDS_HUMAN_MERGE_LABEL } from '#scripts/issue/issue-labels'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { backlog_drive, type OfferRead } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'
import { backlog_fixture } from './backlog-fixture'
import { backlog_next } from './backlog-next'

const CHILD = 901
const SIBLING = 902
const streams = auto_ok_fixture.console_streams()

function arrange(is_epic: boolean, labels: ReadonlyArray<string>, state = 'OPEN'): void {
	const opted_in = [
		is_epic
			? auto_ok_fixture.opted_in_epic()
			: auto_ok_fixture.issue(CHILD, CREATED_EARLIER, labels),
	]

	backlog_fixture.stub_backlog({
		opted_in,
		epics: is_epic ? [{ number: EPIC_NUMBER, children: [CHILD, SIBLING] }] : [],
		children: [{ number: CHILD, labels, state }, { number: SIBLING }],
	})
}

async function offer(): Promise<OfferRead> {
	streams.reset()
	expect(await backlog_next.run([])).toBe(0)
	const issues = streams
		.stdout()
		.split('\n')
		.filter((line) => /^\d+$/u.test(line))

	return { verdict: issues.length === 0 ? 'wait' : 'run', issues, retries: 0 }
}

beforeEach(() => {
	vi.spyOn(console, 'info').mockImplementation(streams.info)
	vi.spyOn(console, 'error').mockImplementation(streams.error)
})

afterEach(() => vi.restoreAllMocks())

describe.each([false, true])('human merge wait, epic: %s', (is_epic) => {
	it('does not relaunch a collected human-review child (ac-4d0f96ed)', async () => {
		arrange(is_epic, [NEEDS_HUMAN_MERGE_LABEL.toUpperCase()])
		const harness = backlog_drive_fixture.harness({
			finished: [String(CHILD)],
			human_review: [String(CHILD)],
		})
		const ports = { ...harness.ports, offer }

		await backlog_drive.run_pass(backlog_drive_fixture.state([String(CHILD)]), true, ports)

		expect(harness.calls).not.toContain(`launch ${String(CHILD)}`)
		expect(harness.calls).toContain(`merge ${String(CHILD)}`)
	})

	it('offers the child again after a person clears the wait (ac-31efbe8e)', async () => {
		arrange(is_epic, [NEEDS_HUMAN_MERGE_LABEL])
		const waiting = await offer()

		expect(waiting.issues).not.toContain(String(CHILD))
		arrange(is_epic, [])
		const released = await offer()

		expect(released.issues).toContain(String(CHILD))
	})
})

it('moves past a merged child even when its wait label remains (ac-31efbe8e)', async () => {
	arrange(true, [NEEDS_HUMAN_MERGE_LABEL], 'CLOSED')
	const next = await offer()

	expect(next.issues).toEqual([String(SIBLING)])
})

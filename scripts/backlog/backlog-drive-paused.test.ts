import type { OpenIssueData } from '#scripts/git/git-schemas'
import { NEEDS_DECISION_LABEL } from '#scripts/issue/issue-labels'
import type { LaneStateRecord } from '#scripts/lane/lane-state'
import { MS_PER_MINUTE } from '#scripts/lib/timeouts'
import { DEFAULT_SILENT_MINUTES } from '#scripts/run/run-liveness'
import { describe, expect, it, vi } from 'vitest'
import { backlog_drive } from './backlog-drive'
import { backlog_drive_fixture } from './backlog-drive-fixture'
import { backlog_drive_paused, type PausedPorts } from './backlog-drive-paused'

// joshuafolkken/kit#4270: a run held only by lanes a person paused tells the person once, rather than
// watching for ever.

const { FIRST_CHILD, harness, offer, state } = backlog_drive_fixture
const NOW_MS = Date.parse('2026-10-20T09:00Z')
const PAUSED_ISSUE = '4211'
const WINDOW_MS = DEFAULT_SILENT_MINUTES * MS_PER_MINUTE
const WAITING_ISSUE = 4300
const SHARED_PATH = 'Touches `scripts/lane/lane-state.ts`.'
const OTHER_PATH = 'Touches `scripts/run/run-board.ts`.'

function record(state_name: LaneStateRecord['state'], age_ms: number): LaneStateRecord {
	return {
		issue: PAUSED_ISSUE,
		state: state_name,
		changed_at: new Date(NOW_MS - age_ms).toISOString(),
		changed_by: 'lane:pause',
	}
}

function issue_of(number: number, body: string, labels: Array<string> = []): OpenIssueData {
	return {
		number,
		title: `Issue ${String(number)}`,
		labels: labels.map((name) => ({ name })),
		createdAt: '2026-10-20T00:00Z',
		body,
	}
}

// The paused lane and a candidate that declares the same path.
const POOL = [issue_of(Number(PAUSED_ISSUE), SHARED_PATH), issue_of(WAITING_ISSUE, SHARED_PATH)]

function paused_ports(
	records: ReadonlyArray<LaneStateRecord>,
	overrides: Partial<PausedPorts> = {},
): PausedPorts {
	return {
		read_records: async () => records,
		read_issues: async () => POOL,
		emit: async (compose) => await compose(),
		send: vi.fn(async () => true),
		now_ms: () => NOW_MS,
		...overrides,
	}
}

describe('backlog_drive — the paused port', () => {
	it('consults the port on a holding offer with nothing of the run in flight', async () => {
		const watching = harness({ offers: [{ ...offer('watch'), answer: 'parked' }] })
		const waiting = harness({ offers: [offer('wait')] })

		await backlog_drive.run_pass(state(), true, watching.ports)
		await backlog_drive.run_pass(state(), true, waiting.ports)

		expect([...watching.pauses, ...waiting.pauses]).toHaveLength(2)
	})

	it('stays quiet while a child of the run is in flight, or on a transient retry', async () => {
		const running = harness({ offers: [offer('watch')] })
		const blocked = harness({ offers: [{ ...offer('watch'), answer: 'blocked' }] })

		await backlog_drive.run_pass(state([FIRST_CHILD]), true, running.ports)
		await backlog_drive.run_pass(state(), true, blocked.ports)

		expect([...running.pauses, ...blocked.pauses]).toStrictEqual([])
	})
})

describe('backlog_drive_paused.notify', () => {
	it('sends one notice naming a lane paused past the silent window, with when and by what', async () => {
		const ports = paused_ports([record('paused', WINDOW_MS)])

		await backlog_drive_paused.notify(ports)

		expect(ports.send).toHaveBeenCalledOnce()
		expect(ports.send).toHaveBeenCalledWith(
			expect.stringMatching(/#4211 — paused since \d\d:\d\d by lane:pause/u),
		)
	})

	it('sends nothing for a pause younger than the window or a lane that is not paused', async () => {
		const ports = paused_ports([record('paused', WINDOW_MS - 1), record('running', WINDOW_MS)])

		await backlog_drive_paused.notify(ports)

		expect(ports.send).not.toHaveBeenCalled()
	})

	it('sends nothing once the episode marker is already on the stream', async () => {
		const ports = paused_ports([record('paused', WINDOW_MS)], { emit: async () => undefined })

		await backlog_drive_paused.notify(ports)

		expect(ports.send).not.toHaveBeenCalled()
	})
})

// The review of joshuafolkken/kit#4270: a lane paused somewhere does not hold a drained or parked
// backlog — only a candidate overlapping its declared paths waits on it.
describe('backlog_drive_paused.notify — a paused lane that holds nothing', () => {
	const PAUSED_LANE = issue_of(Number(PAUSED_ISSUE), SHARED_PATH)

	it.each([
		['a drained backlog', [PAUSED_LANE]],
		['a candidate overlapping no path', [PAUSED_LANE, issue_of(WAITING_ISSUE, OTHER_PATH)]],
		[
			'a candidate a person set aside',
			[PAUSED_LANE, issue_of(WAITING_ISSUE, SHARED_PATH, [NEEDS_DECISION_LABEL])],
		],
		['an unreadable pool', undefined],
	])('sends nothing on %s', async (_name, pool) => {
		const ports = paused_ports([record('paused', WINDOW_MS)], { read_issues: async () => pool })

		await backlog_drive_paused.notify(ports)

		expect(ports.send).not.toHaveBeenCalled()
	})
})

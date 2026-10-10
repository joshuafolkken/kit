import { AUTO_OK_LABEL, PRIORITY_HIGH_LABEL, RUN_LANE_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_add, type AddPorts, type IssueView } from './run-add'

// joshuafolkken/kit#3433: `run:add` labels an issue so a live `backlogrun` takes it, and says per
// issue whether it went in — driven here through fake ports, so no outcome needs `gh`.

const OPEN_ISSUE = 3433
const CLOSED_ISSUE = 3434
const UNREADABLE_ISSUE = 3435
const BLOCKED_ISSUE = 3436
const BLOCKER = 3400

const VIEWS = new Map<number, IssueView>([
	[OPEN_ISSUE, { is_open: true, blockers: [] }],
	[CLOSED_ISSUE, { is_open: false, blockers: [] }],
	[BLOCKED_ISSUE, { is_open: true, blockers: [BLOCKER] }],
])

function fake_ports(refused_label?: string): AddPorts & { applied: Array<string> } {
	const applied: Array<string> = []

	return {
		applied,
		read_issue: async (issue) => VIEWS.get(issue),
		apply_label: async (issue, label) => {
			if (label === refused_label) return false

			applied.push(`${String(issue)}:${label}`)

			return true
		},
	}
}

describe('labels_for', () => {
	it('opts the issue in and puts it first by default', () => {
		expect(run_add.labels_for(true)).toStrictEqual([
			AUTO_OK_LABEL,
			RUN_LANE_LABEL,
			PRIORITY_HIGH_LABEL,
		])
	})

	it('leaves the priority label off with --no-priority', () => {
		expect(run_add.labels_for(false)).toStrictEqual([AUTO_OK_LABEL, RUN_LANE_LABEL])
	})
})

describe('add_all', () => {
	it('queues an open issue after applying every label', async () => {
		const ports = fake_ports()
		const outcomes = await run_add.add_all([OPEN_ISSUE], true, ports)

		expect(outcomes).toStrictEqual([{ kind: 'queued', issue: OPEN_ISSUE, blockers: [] }])
		expect(ports.applied).toHaveLength(run_add.labels_for(true).length)
	})

	it('refuses a closed issue without labelling it', async () => {
		const ports = fake_ports()

		expect(await run_add.add_all([CLOSED_ISSUE], true, ports)).toStrictEqual([
			{ kind: 'closed', issue: CLOSED_ISSUE },
		])
		expect(ports.applied).toStrictEqual([])
	})

	it('refuses an issue that could not be read', async () => {
		expect(await run_add.add_all([UNREADABLE_ISSUE], true, fake_ports())).toStrictEqual([
			{ kind: 'unreadable', issue: UNREADABLE_ISSUE },
		])
	})

	it('stops at the first label that would not apply', async () => {
		const ports = fake_ports(RUN_LANE_LABEL)

		expect(await run_add.add_all([OPEN_ISSUE], true, ports)).toStrictEqual([
			{ kind: 'unlabeled', issue: OPEN_ISSUE, label: RUN_LANE_LABEL },
		])
		expect(ports.applied).toStrictEqual([`${String(OPEN_ISSUE)}:${AUTO_OK_LABEL}`])
	})

	it('keeps the order typed', async () => {
		const outcomes = await run_add.add_all([CLOSED_ISSUE, OPEN_ISSUE], true, fake_ports())

		expect(outcomes.map((outcome) => outcome.issue)).toStrictEqual([CLOSED_ISSUE, OPEN_ISSUE])
	})
})

describe('additions_of', () => {
	it('records only the queued issues, with the priority asked for', async () => {
		const outcomes = await run_add.add_all([OPEN_ISSUE, CLOSED_ISSUE], false, fake_ports())

		expect(run_add.additions_of(outcomes, false)).toStrictEqual([
			{ issue: OPEN_ISSUE, is_priority: false },
		])
	})
})

describe('describe', () => {
	it('says a prioritized issue takes the next free lane', () => {
		expect(run_add.describe({ kind: 'queued', issue: OPEN_ISSUE, blockers: [] }, true)).toBe(
			'queued #3433 · next free lane',
		)
	})

	it('says an appended issue joins the end of the queue', () => {
		expect(run_add.describe({ kind: 'queued', issue: OPEN_ISSUE, blockers: [] }, false)).toBe(
			'queued #3433 · end of the queue',
		)
	})

	it('names the blockers a queued issue waits on', () => {
		const outcome = { kind: 'queued', issue: BLOCKED_ISSUE, blockers: [BLOCKER] } as const

		expect(run_add.describe(outcome, true)).toBe('queued #3436 · waiting: blocked by #3400')
	})

	it('names why an issue was refused', () => {
		expect(run_add.describe({ kind: 'closed', issue: CLOSED_ISSUE }, true)).toBe(
			'refused #3434 · closed',
		)
		expect(run_add.describe({ kind: 'unreadable', issue: UNREADABLE_ISSUE }, true)).toBe(
			'refused #3435 · could not be read',
		)
		expect(
			run_add.describe({ kind: 'unlabeled', issue: OPEN_ISSUE, label: RUN_LANE_LABEL }, true),
		).toBe(`refused #3433 · could not apply \`${RUN_LANE_LABEL}\``)
	})
})

describe('is_all_queued', () => {
	it('is false once any issue was refused', async () => {
		const outcomes = await run_add.add_all([OPEN_ISSUE, CLOSED_ISSUE], true, fake_ports())

		expect(run_add.is_all_queued(outcomes)).toBe(false)
	})
})

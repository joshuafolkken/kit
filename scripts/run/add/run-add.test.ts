import {
	AUTO_OK_LABEL,
	EPIC_LABEL,
	PRIORITY_CRITICAL_LABEL,
	PRIORITY_HIGH_LABEL,
	RUN_LANE_LABEL,
} from '#scripts/issue/issue-labels'
import { describe, expect, it } from 'vitest'
import { run_add, type AddPorts, type IssueView } from './run-add'

// joshuafolkken/kit#3433: `run:add` labels an issue so a live `backlogrun` takes it, and says per
// issue whether it went in — driven here through fake ports, so no outcome needs `gh`.

const OPEN_ISSUE = 3433
const CLOSED_ISSUE = 3434
const UNREADABLE_ISSUE = 3435
const BLOCKED_ISSUE = 3436
const BLOCKER = 3400
const EPIC_ISSUE = 6358
const CLOSED_EPIC = 6359

const VIEWS = new Map<number, IssueView>([
	[CLOSED_EPIC, { is_open: false, labels: [EPIC_LABEL], blockers: [] }],
	[OPEN_ISSUE, { is_open: true, blockers: [] }],
	[CLOSED_ISSUE, { is_open: false, blockers: [] }],
	[BLOCKED_ISSUE, { is_open: true, blockers: [BLOCKER] }],
	[EPIC_ISSUE, { is_open: true, labels: [EPIC_LABEL], blockers: [] }],
])

function fake_ports(refused_label?: string): AddPorts & { applied: Array<string> } {
	const applied: Array<string> = []

	return {
		applied,
		read_issue: async (issue) => VIEWS.get(issue),
		clear_label: async () => true,
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

	it('adds priority:high to an issue with no priority label', () => {
		expect(run_add.labels_for(true, [AUTO_OK_LABEL])).toContain(PRIORITY_HIGH_LABEL)
	})

	it.each([PRIORITY_HIGH_LABEL, PRIORITY_CRITICAL_LABEL])(
		'keeps the priority label already on the issue (%s)',
		(label) => {
			expect(run_add.labels_for(true, [label])).toStrictEqual([AUTO_OK_LABEL, RUN_LANE_LABEL])
		},
	)
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

// joshuafolkken/kit#6840: an epic is tracked as a root, never labelled — kit#6535's labelled epic
// was warned about on every board redraw.
describe('add_all with an epic', () => {
	it('tracks an open epic without labelling it', async () => {
		const ports = fake_ports()

		expect(await run_add.add_all([EPIC_ISSUE], true, ports)).toStrictEqual([
			{ kind: 'tracked', issue: EPIC_ISSUE, is_new: true },
		])
		expect(ports.applied).toStrictEqual([])
	})

	it('refuses a closed epic as closed', async () => {
		const ports = fake_ports()

		expect(await run_add.add_all([CLOSED_EPIC], true, ports)).toStrictEqual([
			{ kind: 'closed', issue: CLOSED_EPIC },
		])
		expect(ports.applied).toStrictEqual([])
	})

	it('does not add an epic the run already tracks again', async () => {
		const context = {
			is_retry: false,
			done: [],
			active: new Set<string>(),
			tracked: new Set([EPIC_ISSUE]),
		}
		const outcomes = await run_add.add_all([EPIC_ISSUE], true, fake_ports(), context)

		expect(outcomes).toStrictEqual([{ kind: 'tracked', issue: EPIC_ISSUE, is_new: false }])
		expect(run_add.additions_of(outcomes, true)).toStrictEqual([])
		expect(run_add.is_all_added(outcomes)).toBe(true)
	})
})

describe('roots_of', () => {
	it('names only the epic roots this call added', async () => {
		const outcomes = await run_add.add_all([OPEN_ISSUE, EPIC_ISSUE], false, fake_ports())

		expect(run_add.roots_of(outcomes)).toStrictEqual(new Set([EPIC_ISSUE]))
		expect(run_add.additions_of(outcomes, false)).toStrictEqual([
			{ issue: OPEN_ISSUE, is_priority: false },
			{ issue: EPIC_ISSUE, is_priority: false },
		])
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

	it('says an epic is tracked as a root', () => {
		expect(run_add.describe({ kind: 'tracked', issue: EPIC_ISSUE, is_new: true }, false)).toBe(
			'tracking #6358 · epic root, end of the queue',
		)
	})
})

describe('is_all_added', () => {
	it('is false once any issue was refused', async () => {
		const outcomes = await run_add.add_all([OPEN_ISSUE, CLOSED_ISSUE], true, fake_ports())

		expect(run_add.is_all_added(outcomes)).toBe(false)
	})
})

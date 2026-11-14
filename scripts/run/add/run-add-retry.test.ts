import {
	EPIC_LABEL,
	IN_PROGRESS_LABEL,
	NEEDS_HUMAN_MERGE_LABEL,
	PRIORITY_CRITICAL_LABEL,
	PRIORITY_HIGH_LABEL,
	RUN_STALLED_LABEL,
} from '#scripts/issue/issue-labels'
import { describe, expect, it, vi } from 'vitest'
import { run_add, type AddContext, type AddPorts } from './run-add'

const ISSUE = 5413
const RETRY_REFUSAL = 'use --retry'
const CONTEXT: AddContext = { is_retry: true, done: [ISSUE], active: new Set() }

function ports_for(labels: ReadonlyArray<string>): AddPorts {
	return {
		read_issue: async () => ({ is_open: true, labels, blockers: [] }),
		apply_label: vi.fn(async () => true),
		clear_label: vi.fn(async () => true),
	}
}

describe('explicit mechanical retry', () => {
	it('clears a mechanical stop only after applying the queue labels', async () => {
		const ports = ports_for([RUN_STALLED_LABEL])

		expect(await run_add.add_all([ISSUE], true, ports, CONTEXT)).toMatchObject([{ kind: 'queued' }])
		expect(ports.clear_label).toHaveBeenCalledWith(ISSUE, RUN_STALLED_LABEL)
	})

	it('refuses a failed stop removal instead of reporting queued', async () => {
		const ports = { ...ports_for([RUN_STALLED_LABEL]), clear_label: async () => false }
		const outcomes = await run_add.add_all([ISSUE], true, ports, CONTEXT)

		expect(run_add.is_all_added(outcomes)).toBe(false)
		expect(run_add.additions_of(outcomes, true)).toStrictEqual([])
	})
})

it('preserves remaining dependencies when explicitly retrying (ac-505a5dfa)', async () => {
	const ports = {
		...ports_for([RUN_STALLED_LABEL]),
		read_issue: async () => ({ is_open: true, blockers: [6400] }),
	}

	expect(await run_add.add_all([ISSUE], true, ports, CONTEXT)).toMatchObject([
		{ kind: 'queued', blockers: [6400] },
	])
})

describe('retry of an issue that already has a priority label', () => {
	it('does not stack priority:high on priority:critical', async () => {
		const ports = ports_for([RUN_STALLED_LABEL, PRIORITY_CRITICAL_LABEL])

		expect(await run_add.add_all([ISSUE], true, ports, CONTEXT)).toMatchObject([{ kind: 'queued' }])
		expect(ports.apply_label).not.toHaveBeenCalledWith(ISSUE, PRIORITY_HIGH_LABEL)
	})

	it('still puts it at the next free lane', async () => {
		const ports = ports_for([RUN_STALLED_LABEL, PRIORITY_CRITICAL_LABEL])
		const outcomes = await run_add.add_all([ISSUE], true, ports, CONTEXT)

		expect(run_add.additions_of(outcomes, true)).toStrictEqual([
			{ issue: ISSUE, is_priority: true },
		])
		expect(outcomes.map((outcome) => run_add.describe(outcome, true))).toStrictEqual([
			`queued #${String(ISSUE)} · next free lane`,
		])
	})
})

// joshuafolkken/kit#6840: a done epic root comes back with --retry, still unlabelled.
describe('retry of a done epic root', () => {
	it('tracks it again without touching its labels', async () => {
		const ports = ports_for([EPIC_LABEL])
		const outcomes = await run_add.add_all([ISSUE], true, ports, CONTEXT)

		expect(outcomes).toStrictEqual([{ kind: 'tracked', issue: ISSUE, is_new: true }])
		expect(run_add.additions_of(outcomes, true)).toStrictEqual([
			{ issue: ISSUE, is_priority: true },
		])
		expect(ports.apply_label).not.toHaveBeenCalled()
		expect(ports.clear_label).not.toHaveBeenCalled()
	})

	it('still asks for --retry without it', async () => {
		const ports = ports_for([EPIC_LABEL])

		expect(
			await run_add.add_all([ISSUE], true, ports, { ...CONTEXT, is_retry: false }),
		).toMatchObject([{ kind: 'refused', reason: RETRY_REFUSAL }])
	})
})

describe('retry and the shared in-progress reader', () => {
	it('protects an issue a run holds', async () => {
		const ports = ports_for([IN_PROGRESS_LABEL.toUpperCase()])

		expect(await run_add.add_all([ISSUE], true, ports, CONTEXT)).toMatchObject([
			{ kind: 'refused', reason: IN_PROGRESS_LABEL },
		])
		expect(ports.apply_label).not.toHaveBeenCalled()
	})

	it('retries a stalled issue still labelled in-progress', async () => {
		const ports = ports_for([RUN_STALLED_LABEL, IN_PROGRESS_LABEL])

		expect(await run_add.add_all([ISSUE], true, ports, CONTEXT)).toMatchObject([{ kind: 'queued' }])
	})
})

// joshuafolkken/kit#7487: only a recorded repair lifts a merge wait.
describe('retry of an issue waiting on a person merge', () => {
	it('clears needs-human-merge for a recorded repair', async () => {
		const ports = ports_for([NEEDS_HUMAN_MERGE_LABEL])
		const context = { ...CONTEXT, repairs: new Set([ISSUE]) }

		expect(await run_add.add_all([ISSUE], true, ports, context)).toMatchObject([{ kind: 'queued' }])
		expect(ports.clear_label).toHaveBeenCalledWith(ISSUE, NEEDS_HUMAN_MERGE_LABEL)
	})

	// joshuafolkken/kit#7493: the ended lane's in-progress would hold the offer.
	it('clears the ended lane in-progress for a recorded repair', async () => {
		const ports = ports_for([NEEDS_HUMAN_MERGE_LABEL, IN_PROGRESS_LABEL])
		const context = { ...CONTEXT, repairs: new Set([ISSUE]) }

		expect(await run_add.add_all([ISSUE], true, ports, context)).toMatchObject([{ kind: 'queued' }])
		expect(ports.clear_label).toHaveBeenCalledWith(ISSUE, IN_PROGRESS_LABEL)
	})

	it('keeps needs-human-merge and in-progress without a recorded repair', async () => {
		const ports = ports_for([NEEDS_HUMAN_MERGE_LABEL, IN_PROGRESS_LABEL])

		await run_add.add_all([ISSUE], true, ports, CONTEXT)
		expect(ports.clear_label).not.toHaveBeenCalledWith(ISSUE, NEEDS_HUMAN_MERGE_LABEL)
		expect(ports.clear_label).not.toHaveBeenCalledWith(ISSUE, IN_PROGRESS_LABEL)
	})

	it('refuses when the merge wait does not clear', async () => {
		const ports = {
			...ports_for([NEEDS_HUMAN_MERGE_LABEL]),
			clear_label: async (_issue: number, label: string) => label !== NEEDS_HUMAN_MERGE_LABEL,
		}
		const context = { ...CONTEXT, repairs: new Set([ISSUE]) }

		expect(await run_add.add_all([ISSUE], true, ports, context)).toMatchObject([
			{ kind: 'refused', reason: `could not clear ${NEEDS_HUMAN_MERGE_LABEL}` },
		])
	})
})

describe('retry protection', () => {
	it.each(['needs-decision', 'needs-human-review', 'already-done'])(
		'protects %s',
		async (label) => {
			const ports = ports_for([RUN_STALLED_LABEL, label.toUpperCase()])

			expect(await run_add.add_all([ISSUE], true, ports, CONTEXT)).toMatchObject([
				{ kind: 'refused' },
			])
			expect(ports.apply_label).not.toHaveBeenCalled()
			expect(ports.clear_label).not.toHaveBeenCalled()
		},
	)

	it('protects an active lane without relying on labels', async () => {
		const ports = ports_for([])
		const context = { ...CONTEXT, active: new Set([String(ISSUE)]) }

		expect(await run_add.add_all([ISSUE], true, ports, context)).toMatchObject([
			{ kind: 'refused', reason: 'active lane' },
		])
		expect(ports.clear_label).not.toHaveBeenCalled()
	})

	it.each([{ labels: [] }, { labels: [RUN_STALLED_LABEL] }])(
		'requires explicit retry for completed or stalled issues: %j',
		async ({ labels }) => {
			const ports = ports_for(labels)
			const context = { ...CONTEXT, is_retry: false }

			expect(await run_add.add_all([ISSUE], true, ports, context)).toMatchObject([
				{ kind: 'refused', reason: RETRY_REFUSAL },
			])
			expect(ports.clear_label).not.toHaveBeenCalled()
		},
	)
})

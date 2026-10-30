import { RUN_STALLED_LABEL } from '#scripts/issue/issue-labels'
import { describe, expect, it, vi } from 'vitest'
import { run_add, type AddContext, type AddPorts } from './run-add'

const ISSUE = 5413
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

		expect(run_add.is_all_queued(outcomes)).toBe(false)
		expect(run_add.additions_of(outcomes, true)).toStrictEqual([])
	})
})

describe('retry protection', () => {
	it.each(['needs-decision', 'needs-human-review', 'already-done', 'in-progress'])(
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
				{ kind: 'refused', reason: 'use --retry' },
			])
			expect(ports.clear_label).not.toHaveBeenCalled()
		},
	)
})

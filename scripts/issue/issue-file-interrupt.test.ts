import { epic_relations } from '#scripts/epic/epic-relations'
import { INTERRUPT_ROUTE_LABEL, SPLIT_ROUTE_LABEL } from '#scripts/issue/issue-labels'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { issue_file_interrupt } from './issue-file-interrupt'

// joshuafolkken/kit#4768: an interrupt a lane files with `--blocks-finder` records its finder as
// blocked by it, in the filing's own command, so a session lost after the filing cannot have the
// finder dispatched again.

const FINDER = '4711'
const BLOCKER = 4738

const apply_relations = vi.spyOn(epic_relations, 'apply_relations')
const info = vi.spyOn(console, 'info')
const error = vi.spyOn(console, 'error')
const warn = vi.spyOn(console, 'warn')

function interrupt_filing(): Parameters<typeof issue_file_interrupt.block_finder>[0] {
	return {
		route: INTERRUPT_ROUTE_LABEL,
		is_blocking_finder: true,
		found_during: FINDER,
		blocker: BLOCKER,
		is_here: true,
	}
}

beforeEach(() => {
	apply_relations.mockResolvedValue(0)
	info.mockImplementation(() => undefined)
	error.mockImplementation(() => undefined)
	warn.mockImplementation(() => undefined)
})

afterEach(() => {
	vi.clearAllMocks()
})

describe('issue_file_interrupt.block_finder — a blocking interrupt with a finder', () => {
	it('records the finder as blocked by the filed Issue', async () => {
		await issue_file_interrupt.block_finder(interrupt_filing())

		expect(apply_relations).toHaveBeenCalledExactlyOnceWith(
			[{ blocked: Number(FINDER), blocker: BLOCKER }],
			'record',
		)
		expect(info).toHaveBeenCalledWith(expect.stringContaining('1 blocked-by relation(s) recorded'))
	})

	// The re-run writes the one relation, never an `epic --add --before` that splices a chain.
	it('reports a failed write on standard error with a relation-only re-run, and resolves', async () => {
		apply_relations.mockResolvedValue(1)

		await expect(issue_file_interrupt.block_finder(interrupt_filing())).resolves.toBeUndefined()

		const line = String(error.mock.calls[0]?.[0])

		expect(line).toContain('could not be recorded as blocked by')
		expect(line).toContain(`issues/${FINDER}/dependencies/blocked_by -F issue_id=`)
		expect(line).toContain(`issues/${String(BLOCKER)} --jq .id`)
		expect(line).not.toContain('epic --add')
	})
})

describe('issue_file_interrupt.block_finder — nothing to record', () => {
	it('stays silent when --blocks-finder was not given', async () => {
		await issue_file_interrupt.block_finder({ ...interrupt_filing(), is_blocking_finder: false })

		expect(apply_relations).not.toHaveBeenCalled()
		expect(warn).not.toHaveBeenCalled()
	})

	const finder_reason = 'no finder and filed Issue pair in this repository'
	const route_reason = '`--route interrupt` only'

	// An explicit `--blocks-finder` that records nothing says so, rather than leaving the caller to
	// read the silence as a recorded relation.
	it.each([
		['no finder', { found_during: undefined }, finder_reason],
		['a finder that is not a number', { found_during: '#4711' }, finder_reason],
		['a filed number that is not a number', { blocker: NaN }, finder_reason],
		['a route other than interrupt', { route: SPLIT_ROUTE_LABEL }, route_reason],
		['no route', { route: undefined }, route_reason],
		['a filing in another repository', { is_here: false }, finder_reason],
	])('records no relation and says so for %s', async (_case, change, reason) => {
		await issue_file_interrupt.block_finder({ ...interrupt_filing(), ...change })

		expect(apply_relations).not.toHaveBeenCalled()
		expect(warn).toHaveBeenCalledExactlyOnceWith(expect.stringContaining(reason))
	})
})

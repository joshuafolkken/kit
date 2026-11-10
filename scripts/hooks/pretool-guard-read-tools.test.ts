import { delivered_rules } from '#scripts/rules/delivered-rules'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pretool_outcome } from './pretool-guard'

// A read-only call reaches only the guards that act on it (joshuafolkken/kit#6041): batching and
// investigation count it, duplicate-read refuses a re-read; the edit guards are skipped by tool name.
// Each guard is mocked so the test pins which ones the consolidated hook asks, not their verdicts.
const CLEAR = { reason: undefined, notice: undefined, fault: undefined }

vi.mock('./implementation-authority', () => ({
	implementation_authority: { reason: vi.fn() },
}))

vi.mock('./lane-plan-guard', () => ({ lane_plan_guard: { reason: vi.fn() } }))

vi.mock('./batch-guard', () => ({ batch_outcome: vi.fn() }))

vi.mock('#scripts/delegation/investigation-guard', () => ({ investigation_outcome: vi.fn() }))

vi.mock('#scripts/delegation/duplicate-read-guard', () => ({ duplicate_read_outcome: vi.fn() }))

vi.mock('#scripts/delegation/large-read-guard', () => ({ large_read_outcome: vi.fn() }))

const { implementation_authority } = await import('./implementation-authority')
const { lane_plan_guard } = await import('./lane-plan-guard')
const { batch_outcome } = await import('./batch-guard')
const { investigation_outcome } = await import('#scripts/delegation/investigation-guard')
const { duplicate_read_outcome } = await import('#scripts/delegation/duplicate-read-guard')
const { large_read_outcome } = await import('#scripts/delegation/large-read-guard')

const GUARDS = {
	'implementation-authority': vi.mocked(implementation_authority.reason),
	batch: vi.mocked(batch_outcome),
	investigation: vi.mocked(investigation_outcome),
	'duplicate-read': vi.mocked(duplicate_read_outcome),
	'large-read': vi.mocked(large_read_outcome),
	'lane-plan': vi.mocked(lane_plan_guard.reason),
}

const READ_GUARDS = ['batch', 'investigation', 'duplicate-read', 'large-read']
const ALL_GUARDS = Object.keys(GUARDS)

beforeEach(() => {
	vi.mocked(implementation_authority.reason).mockReturnValue(undefined)
	vi.mocked(lane_plan_guard.reason).mockReturnValue(undefined)
	vi.mocked(batch_outcome).mockReturnValue(CLEAR)
	vi.mocked(investigation_outcome).mockReturnValue(CLEAR)
	vi.mocked(duplicate_read_outcome).mockReturnValue(CLEAR)
	vi.mocked(large_read_outcome).mockReturnValue(CLEAR)
	vi.spyOn(delivered_rules, 'delivery').mockReturnValue(undefined)
})

afterEach(() => {
	vi.restoreAllMocks()
})

function payload(tool_name: string): string {
	return JSON.stringify({ tool_name, tool_input: {}, transcript_path: '/nonexistent' })
}

function asked_guards(tool_name: string, raw_payload = payload(tool_name)): ReadonlyArray<string> {
	pretool_outcome(raw_payload)

	return Object.entries(GUARDS)
		.filter(([, guard]) => guard.mock.calls.length > 0)
		.map(([name]) => name)
}

describe('pretool_outcome — the guards a tool call reaches', () => {
	it.each(['Read', 'Glob', 'Grep'])('asks only the read guards on %s', (tool_name) => {
		expect(asked_guards(tool_name)).toEqual(READ_GUARDS)
	})

	it.each(['Bash', 'Edit', 'Write', 'Agent', 'WebFetch'])('asks every guard on %s', (tool_name) => {
		expect(asked_guards(tool_name)).toEqual(ALL_GUARDS)
	})

	it('asks every guard on an unparsable payload', () => {
		expect(asked_guards('Read', 'not json')).toEqual(ALL_GUARDS)
	})

	it('keeps the rule rows on a read-only call', () => {
		asked_guards('Glob')

		expect(delivered_rules.delivery).toHaveBeenCalledOnce()
	})

	it('still surfaces a read guard refusal on a read-only call', () => {
		const reason = 'already read'

		vi.mocked(duplicate_read_outcome).mockReturnValue({ ...CLEAR, reason })

		expect(pretool_outcome(payload('Read')).reason).toBe(reason)
	})
})

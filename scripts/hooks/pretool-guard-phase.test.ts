import path from 'node:path'
import type { GuardOutcome } from '#scripts/josh/hook-decision'
import { describe, expect, it, vi } from 'vitest'
import { pretool_guard } from './pretool-guard'

// joshuafolkken/kit#3444: the Codex adapter marks the phase through the same helper as the hook.

vi.mock('#scripts/lane/lane-phase', () => ({
	lane_phase: { mark_implement: vi.fn().mockResolvedValue(undefined) },
}))

const { lane_phase } = await import('#scripts/lane/lane-phase')
const mark_implement = vi.mocked(lane_phase.mark_implement)

const CLEAR: GuardOutcome = { reason: undefined, notice: undefined, fault: undefined }
const NOTICE: GuardOutcome = { ...CLEAR, notice: 'another notice' }
const REFUSED: GuardOutcome = { ...CLEAR, reason: 'refused' }
const CONTEXT = { cwd: process.cwd(), env: process.env, ancestry: vi.fn(() => new Set([1])) }

function tool_payload(tool_name: string, tool_input: Record<string, string>): string {
	return JSON.stringify({ tool_name, tool_input })
}

const EDIT = tool_payload('Edit', {
	file_path: path.join(process.cwd(), 'scripts/hooks/example.ts'),
})
const BASH = tool_payload('Bash', { command: 'ls' })

describe('pretool_guard.mark_phase', () => {
	it('marks allowed runtime edits independently of the reminder', async () => {
		mark_implement.mockClear()

		await pretool_guard.mark_phase(CLEAR, EDIT, CONTEXT)
		await pretool_guard.mark_phase(NOTICE, EDIT, CONTEXT)
		await pretool_guard.mark_phase(REFUSED, EDIT, CONTEXT)
		await pretool_guard.mark_phase(CLEAR, BASH, CONTEXT)

		expect(mark_implement).toHaveBeenCalledTimes(2)
	})

	// joshuafolkken/kit#8922: the call's ancestry finds a root run by its hold's session.
	it('passes the call’s directory, environment and ancestry', async () => {
		mark_implement.mockClear()

		await pretool_guard.mark_phase(CLEAR, EDIT, CONTEXT)

		expect(mark_implement).toHaveBeenCalledWith(CONTEXT.cwd, CONTEXT.env, CONTEXT.ancestry)
	})
})

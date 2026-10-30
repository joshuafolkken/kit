import { closeSync, mkdtempSync, openSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { agent_session_role } from '#scripts/agent/agent-session-role'
import type { GuardOutcome } from '#scripts/josh/hook-decision'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { piped_verification } from '#scripts/rules/piped-verification'
import { afterEach, describe, expect, it, vi } from 'vitest'

// joshuafolkken/kit#3154: a lane child's backgrounded `josh ship` is run in the foreground instead of
// being refused, since a foreground ship detaches itself after its preflight. A separate suite from
// `pretool-guard.test.ts`, which is at its length limit.

vi.mock('#scripts/hooks/lane-plan-guard', () => ({
	lane_plan_guard: { reason: vi.fn().mockReturnValue(undefined) },
}))

vi.mock('#scripts/run/run-watcher-hook', () => ({
	run_watcher_hook: { watcher_hook_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/run/run-parent-cut-hook', () => ({
	run_parent_cut_hook: { parent_cut_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/issue/issue-watch-hook', () => ({
	issue_watch_hook: { watch_reason: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('#scripts/lane/lane-phase', () => ({
	lane_phase: { mark_implement: vi.fn().mockResolvedValue(undefined) },
}))

const { pretool_guard } = await import('./pretool-guard')

const LANE_SHIP = 'pnpm josh ship --detach "Title #1"'
const PIPED_LINT = 'pnpm josh lint:related 2>&1 | tail -5'
const CLEAR: GuardOutcome = { reason: undefined, notice: undefined, fault: undefined }
const REFUSED: GuardOutcome = {
	reason: 'shell-evaluated body',
	notice: undefined,
	fault: undefined,
}

afterEach(() => {
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

function in_lane(): boolean {
	return true
}

function outside_lane(): boolean {
	return false
}

// A real transcript file so the composed guards run their normal disk path rather than failing open.
function fresh_transcript(): string {
	const directory = mkdtempSync(path.join(tmpdir(), 'pretool-guard-foreground-'))
	const transcript_path = path.join(directory, 'transcript.jsonl')

	writeFileSync(transcript_path, '{"type":"user"}\n')
	closeSync(openSync(transcript_path, 'r'))

	return transcript_path
}

function ship_input(run_in_background: boolean, command = LANE_SHIP): string {
	const tool_input = { command, run_in_background }

	return JSON.stringify({ tool_name: 'Bash', tool_input, transcript_path: fresh_transcript() })
}

async function written(raw_payload: string): Promise<string> {
	const write = vi.spyOn(process.stdout, 'write').mockReturnValue(true)

	await pretool_guard.respond(raw_payload)
	const text = write.mock.calls.map((call) => String(call[0])).join('')

	write.mockRestore()

	return text
}

describe('pretool_guard.foreground_rewrite', () => {
	const ship_payload = ship_input(true)

	it('allows the call with the background flag cleared in a lane child', () => {
		const envelope = pretool_guard.foreground_rewrite(CLEAR, ship_payload, in_lane) ?? ''

		expect(envelope).toContain('"permissionDecision":"allow"')
		expect(envelope).toContain('"run_in_background":false')
	})

	it('leaves a refusal from another guard in place', () => {
		expect(pretool_guard.foreground_rewrite(REFUSED, ship_payload, in_lane)).toBeUndefined()
	})

	it('rewrites nothing outside a lane child', () => {
		expect(pretool_guard.foreground_rewrite(CLEAR, ship_payload, outside_lane)).toBeUndefined()
	})

	// joshuafolkken/kit#4101: a foreground ship left at the two-minute default is moved aside by it.
	it('sets the foreground cap on a foreground ship with no timeout in a lane child', () => {
		const envelope = pretool_guard.foreground_rewrite(CLEAR, ship_input(false), in_lane) ?? ''

		expect(envelope).toContain(
			String.raw`"updatedInput":{"command":"pnpm josh ship --detach \"Title #1\"","run_in_background":false,"timeout":600000}`,
		)
	})
})

// A row rewrite must retain the foreground rewrite, so a ship chained after a piped check keeps
// its required execution mode and timeout (joshuafolkken/kit#4101).
describe('pretool_guard.respond — the foreground cap on top of a row rewrite', () => {
	it("caps a lane child's ship on top of the pipefail rewrite, deciding nothing", async () => {
		vi.stubEnv(agent_session_role.KEY, 'worker')
		vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
		const envelope = await written(ship_input(false, `${PIPED_LINT} && ${LANE_SHIP}`))

		expect(envelope).not.toContain('"permissionDecision"')
		expect(envelope).toContain(JSON.stringify(`(set -o pipefail; ${PIPED_LINT}) && ${LANE_SHIP}`))
		expect(envelope).toContain('"timeout":600000')
		expect(envelope).toContain(JSON.stringify(piped_verification.PIPEFAIL_NOTE).slice(1, 40))
	})
})

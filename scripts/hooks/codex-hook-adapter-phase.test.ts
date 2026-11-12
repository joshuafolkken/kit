import { agent_session_role } from '#scripts/agent/agent-session-role'
import { hook_decision } from '#scripts/josh/hook-decision'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { codex_hook_adapter } from './codex-hook-adapter'

const events = vi.hoisted((): Array<RunEvent> => [])

vi.mock('#scripts/hooks/lane-plan-guard', () => ({
	lane_plan_guard: { reason: vi.fn().mockReturnValue(undefined) },
}))
vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: {
		invocation_or_all_events: vi.fn(async () => events),
		emit: vi.fn(async (kind: string, text: string): Promise<void> => {
			events.push({ pos: events.length, at: '2026-11-04T00:00:00.000Z', kind, text })
		}),
	},
}))

const ISSUE = '6347'
const LANE = `/home/dev/.kit-lanes/${ISSUE}`

afterEach(() => {
	events.length = 0
	vi.restoreAllMocks()
	vi.unstubAllEnvs()
})

describe('provider lane implementation events', () => {
	it.each(['apply_patch', 'Edit', 'Write'])(
		'writes plan and implement once for %s without a transcript',
		async (tool_name: string) => {
			vi.stubEnv(agent_session_role.KEY, 'worker')
			vi.stubEnv(lane_child_marker.KEY, ISSUE)
			vi.spyOn(process, 'cwd').mockReturnValue(LANE)
			vi.spyOn(hook_decision, 'load_environment_file').mockReturnValue(undefined)
			vi.spyOn(hook_decision, 'emit_outcome').mockReturnValue(undefined)
			const raw_payload = JSON.stringify({
				tool_name,
				tool_input: {
					command: '*** Begin Patch\n*** Update File: scripts/example.ts\n*** End Patch',
					file_path: 'scripts/example.ts',
				},
			})

			await codex_hook_adapter.write_pretool_outcome(raw_payload)
			await codex_hook_adapter.write_pretool_outcome(raw_payload)

			expect(events.map(({ kind, text }) => [kind, text])).toStrictEqual([
				['plan', `planned #${ISSUE}`],
				['lane-phase', `#${ISSUE} implement`],
			])
		},
	)
})

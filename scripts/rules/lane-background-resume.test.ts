import { describe, expect, it } from 'vitest'
import { lane_background } from './lane-background'
import { stop_rules } from './stop-rules'
import { stop_rules_fixture } from './stop-rules-fixture'

// joshuafolkken/kit#4347: the #4344 lane child resumed its investigator with `SendMessage` and ended
// its turn to wait for it. The stop hook read no subagent as pending, released the hold, and took
// `in-progress` off a lane whose child was still running — so `run:board` showed it 🛑.

const TIMESTAMP = '2026-10-21T02:35:27.101Z'
const AGENT_ID = 'a72297a07f52ca0a9'
const { DECISION_MESSAGE, context } = stop_rules_fixture

function user_line(content: unknown): string {
	return JSON.stringify({ type: 'user', timestamp: TIMESTAMP, message: { content } })
}

// The `SendMessage` result the harness wrote for the #4344 child, in its real shape.
function resume_line(id: string): string {
	const text = JSON.stringify({
		success: true,
		message: `Resuming agent ${id.slice(0, 7)}`,
		resumedAgentId: id,
		pin: { id, name: id, ref: 'd632ac' },
	})

	return user_line([
		{ type: 'tool_result', tool_use_id: 'toolu_1', content: [{ type: 'text', text }] },
	])
}

function launch_line(id: string): string {
	const text = `Async agent launched successfully.\nagentId: ${id} (internal ID)`

	return user_line([
		{ type: 'tool_result', tool_use_id: 'toolu_2', content: [{ type: 'text', text }] },
	])
}

function finish_line(id: string): string {
	return user_line(`<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>`)
}

// A held, clean stop whose reply names its decision — the one that runs the release — with
// `agent_pending` read off `tail`.
function held_stop(tail: string): ReturnType<typeof context> {
	const is_pending = lane_background.pending_agent_ids(tail).length > 0
	const pending = { agent_pending: is_pending, background_pending: is_pending }

	return context({ ...pending, hold_issue: '4344', message: DECISION_MESSAGE, tree_clean: true })
}

describe('lane_background.pending_agent_ids — a resumed subagent', () => {
	it('reports a subagent resumed by SendMessage and not yet finished', () => {
		expect(lane_background.pending_agent_ids(resume_line(AGENT_ID))).toStrictEqual([AGENT_ID])
	})

	it('reports a resumed subagent whose earlier run already sent its finish notice', () => {
		const tail = [launch_line(AGENT_ID), finish_line(AGENT_ID), resume_line(AGENT_ID)].join('\n')

		expect(lane_background.pending_agent_ids(tail)).toStrictEqual([AGENT_ID])
	})

	it('drops a resumed subagent once its finish notice follows the resume', () => {
		const tail = [resume_line(AGENT_ID), finish_line(AGENT_ID)].join('\n')

		expect(lane_background.pending_agent_ids(tail)).toStrictEqual([])
	})
})

describe('stop_rules.stop_outcome — a held lane waiting on a resumed subagent', () => {
	it('keeps the hold and in-progress while the resumed subagent runs', () => {
		const outcome = stop_rules.stop_outcome(held_stop(resume_line(AGENT_ID)))

		expect(outcome).toEqual(stop_rules.NO_OUTCOME)
	})

	it('releases once the resumed subagent has finished', () => {
		const tail = [resume_line(AGENT_ID), finish_line(AGENT_ID)].join('\n')
		const { actions } = stop_rules.stop_outcome(held_stop(tail))

		expect(actions.map((action) => action.kind)).toContain('release')
	})
})

// joshuafolkken/kit#4803: the #4744 child, told only to "wait in the foreground", hand-wrote a loop over
// the subagent's `.output` that never saw it finish and ran to its 300-second cap.
const COMMAND_ID = 'bxj18z032'

function command_launch_line(id: string): string {
	const content = `Command running in background with ID: ${id}`

	return user_line([{ type: 'tool_result', tool_use_id: 'toolu_3', content }])
}

// A lane child's stop with every pending fact read off `tail`, as `stop-guard.ts` reads them.
function lane_stop_reason(tail: string): string | undefined {
	const pending = {
		background_pending: lane_background.pending_background_ids(tail).length > 0,
		agent_pending: lane_background.pending_agent_ids(tail).length > 0,
		command_pending: lane_background.pending_command_ids(tail).length > 0,
	}

	return stop_rules.stop_outcome(context({ ...pending, lane_child: true })).reason
}

describe('stop_rules.stop_outcome — the wait a lane child is sent to', () => {
	it('sends a child waiting only on a resumed subagent to the subagent wait', () => {
		expect(lane_stop_reason(resume_line(AGENT_ID))).toBe(lane_background.LANE_AGENT_STOP_REASON)
	})

	it('keeps the command wait while a command is still running beside the subagent', () => {
		const tail = [command_launch_line(COMMAND_ID), resume_line(AGENT_ID)].join('\n')

		expect(lane_stop_reason(tail)).toBe(lane_background.LANE_BACKGROUND_STOP_REASON)
	})

	it('keeps the command wait for a command alone', () => {
		const reason = lane_stop_reason(command_launch_line(COMMAND_ID))

		expect(reason).toBe(lane_background.LANE_BACKGROUND_STOP_REASON)
	})

	it('reads no subagent as a pending command', () => {
		expect(lane_background.pending_command_ids(resume_line(AGENT_ID))).toStrictEqual([])
	})

	it('names a wait the completion notice can reach, not a loop over the output', () => {
		expect(lane_background.LANE_AGENT_STOP_REASON).toContain('one short foreground call at a time')
	})
})

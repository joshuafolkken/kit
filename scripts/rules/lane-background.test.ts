import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { lane_background } from './lane-background'
import { stop_rules } from './stop-rules'
import { stop_rules_fixture } from './stop-rules-fixture'

// joshuafolkken/kit#2704: a headless lane child backgrounded `pnpm josh gate && pnpm josh git -y …`,
// ended its turn, and the gate died at `exit code 143`. These pin both halves: the launch is refused in a
// lane child only, and a stop with a task still running is sent back to wait rather than to notify.

const BASH = 'Bash'
const GATE_AND_PUSH = 'pnpm josh gate > gate.log 2>&1 && pnpm josh git -y "Fix it #2606"'
const GATE = 'pnpm josh gate'
const ROW_ID = 'lane-background'
const SHIP = 'pnpm josh ship "Title #1" --body-file evidence.md'
const DETACHED_SHIP = 'pnpm josh ship --detach --review "Title #1"'
const GATE_AND_SHIP = `${GATE} && ${DETACHED_SHIP}`
const FOREGROUND_TIMEOUT_MS = 600_000
const BACKGROUND_TIMEOUT_MS = 1_800_000

function in_lane(): boolean {
	return true
}

function outside_lane(): boolean {
	return false
}

function never(): boolean {
	throw new Error('the lane mark was read')
}

const TIMESTAMP = '2026-09-29T03:00:00.000Z'
const TASK_ID = 'bxj18z032'
const AGENT_ID = 'a6b97a47275a1a193'
const DROPS_FINISHED_AGENT = 'drops a subagent whose finish notice is on the tail'
const { action_kinds, context } = stop_rules_fixture
// A held stop whose reply names its decision — the one a notify is sent for (joshuafolkken/kit#3961).
const HELD_DECISION = { hold_issue: '7', message: stop_rules_fixture.DECISION_MESSAGE }

function background_call(command: string): { name: string; input: Record<string, unknown> } {
	return { name: BASH, input: { command, run_in_background: true } }
}

function launch_line(id: string, content = `Command running in background with ID: ${id}`): string {
	const result = { type: 'tool_result', tool_use_id: 'toolu_1', content }

	return JSON.stringify({ type: 'user', timestamp: TIMESTAMP, message: { content: [result] } })
}

// The result the harness writes when a foreground call outruns its timeout (joshuafolkken/kit#3304).
function moved_line(id: string, seconds = 600): string {
	const content = `Command did not complete within its ${String(seconds)}s timeout and was moved to the background (ID: ${id}).`

	return launch_line(id, content)
}

// The launch result the harness writes for a subagent taken into the background (joshuafolkken/kit#2774),
// in the list-of-text-blocks shape it really uses.
function agent_launch_line(id: string): string {
	const text = `Async agent launched successfully.\nagentId: ${id} (internal ID)`
	const result = {
		type: 'tool_result',
		tool_use_id: 'toolu_2',
		content: [
			{ type: 'text', text },
			{ type: 'text', text: 'output_file: /tmp/x.output' },
		],
	}

	return JSON.stringify({ type: 'user', timestamp: TIMESTAMP, message: { content: [result] } })
}

function finish_line(id: string): string {
	const content = `<task-notification>\n<task-id>${id}</task-id>\n<status>completed</status>`

	return JSON.stringify({ type: 'user', timestamp: TIMESTAMP, message: { content } })
}

// The `TaskStop` result the harness writes in place of a notice (joshuafolkken/kit#4472).
function stopped_line(id: string): string {
	const body = { message: `Successfully stopped task: ${id} (pnpm josh test:related)`, task_id: id }

	return launch_line(id, JSON.stringify(body))
}

describe('lane_background.is_background_long_run', () => {
	it.each([
		GATE_AND_PUSH,
		GATE,
		'pnpm josh ga',
		'pnpm josh followup --merge',
		'JOSH_CI_TIMEOUT_SECONDS=600 pnpm josh git -y "Title #1"',
	])('refuses a lane child backgrounding %s', (command) => {
		expect(lane_background.is_background_long_run(background_call(command), in_lane)).toBe(true)
	})

	it('leaves the same command alone outside a lane child', () => {
		const call = background_call(GATE_AND_PUSH)

		expect(lane_background.is_background_long_run(call, outside_lane)).toBe(false)
	})

	it('leaves a foreground gate alone', () => {
		const call = { name: BASH, input: { command: GATE } }

		expect(lane_background.is_background_long_run(call, in_lane)).toBe(false)
	})

	it('claims a foreground push in a lane child, so run-tail never asks for the backgrounded reissue', () => {
		const call = { name: BASH, input: { command: GATE_AND_PUSH } }

		expect(lane_background.is_background_long_run(call, in_lane)).toBe(true)
		expect(lane_background.is_background_long_run(call, outside_lane)).toBe(false)
	})

	it.each(['pnpm josh test:related', 'sleep 5'])('leaves a backgrounded %s alone', (command) => {
		expect(lane_background.is_background_long_run(background_call(command), in_lane)).toBe(false)
	})

	it('does not read the lane mark for a call that is not a candidate', () => {
		expect(lane_background.is_background_long_run(background_call('ls'), never)).toBe(false)
	})
})

// joshuafolkken/kit#3027: a child's `ship` detaches only after its preflight passed in the calling
// process, so a backgrounded one dies with the turn before any supervisor exists. joshuafolkken/kit#3154:
// a backgrounded ship alone is rewritten into the foreground rather than refused.
describe('lane_background.is_background_long_run — ship', () => {
	it.each([SHIP, DETACHED_SHIP])('does not refuse a backgrounded ship alone: %s', (command) => {
		expect(lane_background.is_background_long_run(background_call(command), in_lane)).toBe(false)
	})

	it('still refuses a backgrounded ship chained after the gate', () => {
		const call = background_call(GATE_AND_SHIP)

		expect(lane_background.is_background_long_run(call, in_lane)).toBe(true)
	})

	it('leaves a foreground ship alone, which returns at the hand-off', () => {
		const call = { name: BASH, input: { command: DETACHED_SHIP } }

		expect(lane_background.is_background_long_run(call, in_lane)).toBe(false)
	})

	it('leaves a backgrounded ship alone outside a lane child', () => {
		expect(lane_background.is_background_long_run(background_call(SHIP), outside_lane)).toBe(false)
	})
})

describe('lane_background.foreground_input', () => {
	it('clears the background flag of a backgrounded ship in a lane child and keeps the command', () => {
		const input = lane_background.foreground_input(background_call(DETACHED_SHIP), in_lane)

		expect(input).toStrictEqual({
			command: DETACHED_SHIP,
			run_in_background: false,
			timeout: FOREGROUND_TIMEOUT_MS,
		})
	})

	it('replaces a background-sized timeout with the foreground cap', () => {
		const input = { command: SHIP, run_in_background: true, timeout: BACKGROUND_TIMEOUT_MS }
		const rewritten = lane_background.foreground_input({ name: BASH, input }, in_lane)

		expect(rewritten?.['timeout']).toBe(FOREGROUND_TIMEOUT_MS)
	})

	it('leaves a backgrounded ship outside a lane child untouched', () => {
		expect(lane_background.foreground_input(background_call(SHIP), outside_lane)).toBeUndefined()
	})

	it('does not rewrite a ship chained after the gate', () => {
		expect(
			lane_background.foreground_input(background_call(GATE_AND_SHIP), in_lane),
		).toBeUndefined()
	})
})

// joshuafolkken/kit#4101: the #4091 child's foreground ship ran at the two-minute default, was moved to
// the background by it, and died with the turn before its supervisor existed.
describe('lane_background.foreground_input — a foreground ship', () => {
	it('gives a foreground ship with no timeout the foreground cap in a lane child', () => {
		const call = { name: BASH, input: { command: DETACHED_SHIP } }

		expect(lane_background.foreground_input(call, in_lane)).toStrictEqual({
			command: DETACHED_SHIP,
			run_in_background: false,
			timeout: FOREGROUND_TIMEOUT_MS,
		})
	})

	it('raises a foreground ship timeout under the cap to it', () => {
		const input = { command: SHIP, timeout: 120_000 }
		const rewritten = lane_background.foreground_input({ name: BASH, input }, in_lane)

		expect(rewritten?.['timeout']).toBe(FOREGROUND_TIMEOUT_MS)
	})

	it('leaves a foreground ship already at the cap alone, without reading the lane mark', () => {
		const call = { name: BASH, input: { command: DETACHED_SHIP, timeout: FOREGROUND_TIMEOUT_MS } }

		expect(lane_background.foreground_input(call, never)).toBeUndefined()
	})

	it('leaves a foreground ship outside a lane child untouched', () => {
		const call = { name: BASH, input: { command: DETACHED_SHIP } }

		expect(lane_background.foreground_input(call, outside_lane)).toBeUndefined()
	})

	it('does not rewrite a command other than ship, nor read the lane mark for it', () => {
		expect(
			lane_background.foreground_input({ name: BASH, input: { command: GATE } }, never),
		).toBeUndefined()
	})
})

describe('lane_background.ROW — delivery', () => {
	it('is registered as a delivered rule refusing every occurrence', () => {
		const row = delivered_rules.DELIVERED_RULES.find((rule) => rule.id === ROW_ID)

		expect(row?.reason).toBe(lane_background.LANE_BACKGROUND_REASON)
		expect(row?.decide?.(background_call('ls'), { transcript: '', now_ms: 0 }, false, 0)).toBe(true)
	})

	it('is listed before run-tail, whose foreground push it claims in a lane child', () => {
		const ids = delivered_rules.DELIVERED_RULES.map((rule) => rule.id)

		expect(ids.indexOf(ROW_ID)).toBeLessThan(ids.indexOf('run-tail'))
	})

	it('names the detached ship as the route', () => {
		expect(lane_background.LANE_BACKGROUND_REASON).toContain('pnpm josh ship --detach')
	})

	it('says the ship is issued in the foreground', () => {
		expect(lane_background.LANE_BACKGROUND_REASON).toContain('issued in the foreground')
	})
})

describe('lane_background.pending_background_ids', () => {
	it('reports a task launched and never finished', () => {
		expect(lane_background.pending_background_ids(launch_line(TASK_ID))).toStrictEqual([TASK_ID])
	})

	it('drops a task whose finish notice is on the tail', () => {
		const tail = [launch_line(TASK_ID), finish_line(TASK_ID)].join('\n')

		expect(lane_background.pending_background_ids(tail)).toStrictEqual([])
	})

	it('reports a subagent launched into the background and never finished', () => {
		expect(lane_background.pending_background_ids(agent_launch_line(AGENT_ID))).toStrictEqual([
			AGENT_ID,
		])
	})

	it(DROPS_FINISHED_AGENT, () => {
		const tail = [agent_launch_line(AGENT_ID), finish_line(AGENT_ID)].join('\n')

		expect(lane_background.pending_background_ids(tail)).toStrictEqual([])
	})

	// joshuafolkken/kit#3304: the #3273 child's foreground call outran its timeout, was moved to the
	// background, and the stop hook let the child end its turn on it.
	it('reports a foreground call moved to the background at its timeout', () => {
		expect(lane_background.pending_background_ids(moved_line(TASK_ID))).toStrictEqual([TASK_ID])
	})

	// joshuafolkken/kit#4101: the #4091 ship was moved aside at the two-minute default.
	it('reports a call moved to the background at the two-minute default', () => {
		expect(lane_background.pending_background_ids(moved_line(TASK_ID, 120))).toStrictEqual([
			TASK_ID,
		])
	})

	it('drops a moved call whose finish notice is on the tail', () => {
		const tail = [moved_line(TASK_ID), finish_line(TASK_ID)].join('\n')

		expect(lane_background.pending_background_ids(tail)).toStrictEqual([])
	})

	it('ignores a partial first line and a tail with no launch', () => {
		expect(lane_background.pending_background_ids('{"type":"us\nnot json')).toStrictEqual([])
	})
})

// joshuafolkken/kit#4472: the #4469 child stopped a moved call with `TaskStop`, which writes no
// notice, and every stop after it was sent back.
describe('lane_background.pending_background_ids — a task stopped with TaskStop', () => {
	it('drops a moved call stopped with TaskStop', () => {
		const tail = [moved_line(TASK_ID), stopped_line(TASK_ID)].join('\n')

		expect(lane_background.pending_background_ids(tail)).toStrictEqual([])
	})

	it('keeps a task open when TaskStop stopped a different one', () => {
		const tail = [launch_line(TASK_ID), stopped_line('b9other9')].join('\n')

		expect(lane_background.pending_background_ids(tail)).toStrictEqual([TASK_ID])
	})
})

describe('lane_background.pending_agent_ids', () => {
	it('reports the subagent and leaves a command out', () => {
		const tail = [launch_line(TASK_ID), agent_launch_line(AGENT_ID)].join('\n')

		expect(lane_background.pending_agent_ids(tail)).toStrictEqual([AGENT_ID])
	})

	it(DROPS_FINISHED_AGENT, () => {
		const tail = [agent_launch_line(AGENT_ID), finish_line(AGENT_ID)].join('\n')

		expect(lane_background.pending_agent_ids(tail)).toStrictEqual([])
	})
})

describe('stop_rules.stop_outcome — lane background wait', () => {
	it('sends a lane child with a running task back to wait instead of to notify', () => {
		const held = context({ lane_child: true, background_pending: true, hold_issue: '7' })

		expect(stop_rules.stop_outcome(held)).toEqual({
			...stop_rules.NO_OUTCOME,
			reason: lane_background.LANE_BACKGROUND_STOP_REASON,
		})
	})

	it('stays silent outside a lane child', () => {
		const stop = context({ background_pending: true })

		expect(stop_rules.stop_outcome(stop).reason).toBeUndefined()
	})

	// joshuafolkken/kit#2774: the subagent's completion notice re-invokes the session, so nobody is waited on.
	it.each([true, false])(
		'asks no notify or release of a held run waiting on a subagent (tree clean: %s)',
		(tree_clean) => {
			const pending = { background_pending: true, agent_pending: true }
			const held = context({ ...pending, hold_issue: '7', tree_clean })

			expect(stop_rules.stop_outcome(held)).toEqual(stop_rules.NO_OUTCOME)
		},
	)

	it.each([
		['nothing running', {}],
		['only a command running, which may never end', { background_pending: true }],
	])('still sends the notify of a held run with %s', (_label, pending) => {
		expect(action_kinds({ ...pending, ...HELD_DECISION })).toEqual(['notify'])
	})

	it('honours the loop-breaker', () => {
		const repeated = context({ lane_child: true, background_pending: true, stop_hook_active: true })

		expect(stop_rules.stop_outcome(repeated).reason).toBeUndefined()
	})
})

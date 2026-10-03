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
const { context } = stop_rules_fixture

function background_call(command: string): { name: string; input: Record<string, unknown> } {
	return { name: BASH, input: { command, run_in_background: true } }
}

function launch_line(id: string): string {
	const result = {
		type: 'tool_result',
		tool_use_id: 'toolu_1',
		content: `Command running in background with ID: ${id}`,
	}

	return JSON.stringify({ type: 'user', timestamp: TIMESTAMP, message: { content: [result] } })
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
// process, so a backgrounded one dies with the turn before any supervisor exists.
describe('lane_background.is_background_long_run — ship', () => {
	it.each([SHIP, DETACHED_SHIP])('refuses a backgrounded ship in a lane child: %s', (command) => {
		expect(lane_background.is_background_long_run(background_call(command), in_lane)).toBe(true)
	})

	it('leaves a foreground ship alone, which returns at the hand-off', () => {
		const call = { name: BASH, input: { command: DETACHED_SHIP } }

		expect(lane_background.is_background_long_run(call, in_lane)).toBe(false)
	})

	it('leaves a backgrounded ship alone outside a lane child', () => {
		expect(lane_background.is_background_long_run(background_call(SHIP), outside_lane)).toBe(false)
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

	it('ignores a partial first line and a tail with no launch', () => {
		expect(lane_background.pending_background_ids('{"type":"us\nnot json')).toStrictEqual([])
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
		const held = context({ lane_child: true, background_pending: true, hold_present: true })

		expect(stop_rules.stop_outcome(held).reason).toBe(lane_background.LANE_BACKGROUND_STOP_REASON)
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
			const held = context({ ...pending, hold_present: true, tree_clean })

			expect(stop_rules.stop_outcome(held).reason).toBeUndefined()
		},
	)

	it.each([
		['nothing running', {}],
		['only a command running, which may never end', { background_pending: true }],
	])('still asks the notify of a held run with %s', (_label, pending) => {
		const held = context({ ...pending, hold_present: true })

		expect(stop_rules.stop_outcome(held).reason).toBe(stop_rules.STOP_NOTIFY_REASON)
	})

	it('still refuses a bare issue number while a subagent runs', () => {
		const pending = { background_pending: true, agent_pending: true }
		const stop = context({ ...pending, hold_present: true, message: 'See #2774.' })

		expect(stop_rules.stop_outcome(stop).reason).toContain('issue citation')
	})

	it('honours the loop-breaker', () => {
		const repeated = context({ lane_child: true, background_pending: true, stop_hook_active: true })

		expect(stop_rules.stop_outcome(repeated).reason).toBeUndefined()
	})
})

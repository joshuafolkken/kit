import type { ShipStop } from '#scripts/lane/lane-child-invocation'
import { lane_session_action } from '#scripts/lane/lane-session-action'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const request_mock = vi.hoisted(() => vi.fn())
const LANE = vi.hoisted(() => ({ issue: '4489', directory: '/lanes/4489', profile: undefined }))

vi.mock('#scripts/run/event/run-event-stream-emit', () => ({
	run_event_stream_emit: { emit: vi.fn() },
}))
vi.mock('#scripts/lane/lane-child-marker', () => ({
	lane_child_marker: { is_child_of: () => true },
}))
vi.mock('#scripts/lane/lane-registry', () => ({
	lane_registry: { find_open_lane: async (): Promise<unknown> => LANE },
}))
vi.mock('#scripts/lane/lane-session-broker', () => ({
	lane_session_broker: { serving_session: () => 'server-1', request: request_mock },
}))
vi.mock('#scripts/git/changed-paths', () => ({
	changed_paths: { read_changed_paths: async (): Promise<Array<string>> => ['scripts/changed.ts'] },
}))
vi.mock('./run-ship-probe', () => ({ run_ship_probe: { read_review_stale: async () => true } }))
vi.mock('./run-ship-relaunch-cap', () => ({
	run_ship_relaunch_cap: { is_over: async () => false },
}))

const { run_ship_return } = await import('./run-ship-return')

// joshuafolkken/kit#4489: the ship added `cause` to the relaunch stop and the broker's strict schema
// refused every relaunch. The stop the ship's own code builds, every field filled, must parse on the
// broker's own schema, so a field added on one side only fails here.

const ISSUE = LANE.issue
const ARGS = {
	number: ISSUE,
	title: `Accept the stop cause #${ISSUE}`,
	notify: [],
	body: [],
	body_path: 'scratchpad/evidence.md',
	cites: [],
	is_review: true,
	is_detach: true,
	unpinned_ok: [],
}
const FAILED = { body: 'FAIL gate', conflicts: ['scripts/a.ts'], cause: 'finding' } as const
// Typed `Required`, so a field the stop gains fails the type check until it is filled here as well.
const EVERY_FIELD: Required<ShipStop> = {
	stage: 'review',
	title: '',
	flags: [],
	is_review: true,
	conflicts: [],
	cause: 'finding',
	is_review_stale: true,
	context: { excerpt: [], changed: [], more_changed: 0 },
}

beforeEach(() => {
	request_mock.mockReset().mockResolvedValue({ is_success: true })
	vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
})

async function requested_action(): Promise<unknown> {
	await run_ship_return.hand_back(ARGS, 'review', FAILED)

	return (request_mock.mock.calls[0] ?? [])[2]
}

describe('run_ship_return.hand_back — the relaunch request the broker reads', () => {
	it('builds a stop with every field the stop type has', async () => {
		const action = await requested_action()
		const { stop } = action as { stop: object }

		expect(new Set(Object.keys(stop))).toStrictEqual(new Set(Object.keys(EVERY_FIELD)))
	})

	it("parses on the broker's action schema", async () => {
		const parsed = lane_session_action.action_schema.safeParse(await requested_action())

		expect(parsed.error?.issues).toBeUndefined()
	})
})

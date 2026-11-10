import type { RunEvent } from '#scripts/run/event/run-event-stream'
import { describe, expect, it } from 'vitest'
import { lane_implement_signals, type ImplementSignals } from './lane-implement-signals'
import type { ToolCall } from './lane-transcript-calls'

// joshuafolkken/kit#6983: what a lane's implementation spent its time on, recorded as a trace and read
// back as cause keys.

const ROOT = '/repo'
const TEST_RELATED = 'pnpm josh test:related'
const ISSUE = 6983
const QUIET: ImplementSignals = {
	edits: 1,
	test_related: 1,
	lint_related: 1,
	investigations: 1,
	unplanned: 0,
}

function call(overrides: Partial<ToolCall>): ToolCall {
	return {
		session_id: 's',
		lane: 'l',
		started_ms: 0,
		duration_ms: 1,
		tool: 'Bash',
		background: false,
		command: undefined,
		subagent: undefined,
		output: '',
		...overrides,
	}
}

function event_of(text: string, kind: string = lane_implement_signals.KIND): RunEvent {
	return { pos: 1, at: '2026-11-10T00:00:00.000Z', kind, text }
}

describe('lane_implement_signals.counts_of', () => {
	it('counts distinct edited files, related reruns, investigator units and unplanned edits', () => {
		const calls = [
			call({ tool: 'Edit', file_path: `${ROOT}/scripts/a.ts` }),
			call({ tool: 'Write', file_path: `${ROOT}/scripts/a.ts` }),
			call({ tool: 'Edit', file_path: `${ROOT}/scripts/b.ts` }),
			call({ tool: 'Write', file_path: `${ROOT}/scripts/b.test.ts` }),
			call({ tool: 'Write', file_path: '/elsewhere/c.md' }),
			call({ tool: 'Write', file_path: `${ROOT}/.josh/tmp/body.md` }),
			call({ command: TEST_RELATED }),
			call({ command: TEST_RELATED }),
			call({ command: 'pnpm josh lint:related' }),
			call({ tool: 'Agent', subagent: { type: 'kit:investigator', model: undefined } }),
			call({ tool: 'Agent', subagent: { type: 'reviewer', model: undefined } }),
		]

		expect(lane_implement_signals.counts_of(calls, ['scripts/a.ts'], ROOT)).toEqual({
			edits: 3,
			test_related: 2,
			lint_related: 1,
			investigations: 1,
			unplanned: 1,
		})
	})
})

describe('lane_implement_signals.counts_of related commands', () => {
	it('counts a related run after a separator, not a search for its name or a longer command', () => {
		const calls = [
			call({ command: `cd /repo && ${TEST_RELATED} scripts/a.ts` }),
			call({ command: "grep -rn 'josh test:related' scripts" }),
			call({ command: 'pnpm josh test:related-watch' }),
			call({ command: 'echo pnpm josh lint:related' }),
		]

		expect(lane_implement_signals.counts_of(calls, [], ROOT)).toMatchObject({
			test_related: 1,
			lint_related: 0,
		})
	})
})

describe('lane_implement_signals.signals_of', () => {
	const signals = { ...QUIET, test_related: 4, unplanned: 2 }

	it('reads back the newest signals the issue recorded', () => {
		const events = [
			event_of(lane_implement_signals.text_of(String(ISSUE), QUIET)),
			event_of(lane_implement_signals.text_of(String(ISSUE), signals)),
		]

		expect(lane_implement_signals.signals_of(events, ISSUE)).toEqual(signals)
	})

	it('ignores another issue, another kind and a lane phase', () => {
		const events = [
			event_of(lane_implement_signals.text_of(String(ISSUE + 1), signals)),
			event_of(lane_implement_signals.text_of(String(ISSUE), signals), 'note'),
			event_of(`#${String(ISSUE)} implement`),
		]

		expect(lane_implement_signals.signals_of(events, ISSUE)).toBeUndefined()
	})
})

describe('lane_implement_signals.keys_of', () => {
	it('names each signal past its bar', () => {
		const signals = { edits: 9, test_related: 3, lint_related: 3, investigations: 2, unplanned: 1 }

		expect(lane_implement_signals.keys_of(signals)).toEqual([
			'plan divergence',
			'edited files',
			'test:related reruns',
			'lint:related reruns',
			'investigation units',
		])
	})

	it('names nothing at every bar', () => {
		const at_bars = { edits: 8, test_related: 2, lint_related: 2, investigations: 1, unplanned: 0 }

		expect(lane_implement_signals.keys_of(at_bars)).toEqual([])
	})
})

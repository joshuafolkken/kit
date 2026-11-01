import { describe, expect, it, vi } from 'vitest'
import type { Breakdown } from './lane-breakdown'
import { lane_breakdown_calls } from './lane-breakdown-calls'
import { lane_breakdown_implement } from './lane-breakdown-implement'
import { lane_breakdown_text } from './lane-breakdown-text'
import { lane_transcript_calls, type Subagent, type ToolCall } from './lane-transcript-calls'
import { lane_transcript_stats } from './lane-transcript-stats'

// joshuafolkken/kit#5539: #5519's breakdown printed the `test` and `subagent: reviewer` rows' totals
// with no word on which calls made them up, so its overrun investigation stopped at the row. Each row
// now prints its longest three call groups, a reviewer's split by pass and level.

const MINUTE_MS = 60_000
const PLAN_FROM = 0
const IMPLEMENT_FROM = 10 * MINUTE_MS
const IMPLEMENT_TO = 61 * MINUTE_MS
const REVIEWER = 'subagent: reviewer'
const TEST_RELATED = 'pnpm josh test:related --touched'
const MEDIUM = 'medium'
const GIT_STATUS = 'git status'
const GIT_LOG = 'git log'
const GH_VIEW = 'gh issue view 1'
const RUN_PREP = 'pnpm josh run:prep 1'
const LINT_LABEL = 'lint:related'
const LINT_RELATED = `pnpm josh ${LINT_LABEL}`
const LINT_DETAIL = 'prettier 1.0 s · eslint 400.0 s · 12 file(s) · daemon started · cache absent'

const BREAKDOWN: Breakdown = {
	stages: [
		{ name: 'implement', ms: IMPLEMENT_TO - IMPLEMENT_FROM },
		{ name: 'start to plan', ms: IMPLEMENT_FROM - PLAN_FROM },
	],
	excluded_ms: 0,
	slept_ms: 0,
	yield_ms: 0,
	waits: [],
	plan: [{ from_ms: PLAN_FROM, to_ms: IMPLEMENT_FROM }],
	implement: [{ from_ms: IMPLEMENT_FROM, to_ms: IMPLEMENT_TO }],
	pre_detach: [],
	ship: [],
}

function call(minute: number, minutes: number, input: Partial<ToolCall>): ToolCall {
	return {
		session_id: 's',
		lane: '5519',
		started_ms: minute * MINUTE_MS,
		duration_ms: minutes * MINUTE_MS,
		tool: 'Bash',
		background: false,
		command: undefined,
		subagent: undefined,
		output: '',
		...input,
	}
}

function timing_output(detail: string): string {
	return `Checking formatting...\njosh lint:related timing — ${detail}\n`
}

function bash(minute: number, minutes: number, command: string): ToolCall {
	return call(minute, minutes, { command })
}

function reviewer(minute: number, minutes: number, subagent: Partial<Subagent>): ToolCall {
	const agent = { type: 'reviewer', model: undefined, ...subagent }

	return call(minute, minutes, { tool: 'Agent', subagent: agent })
}

function groups_of(calls: ReadonlyArray<ToolCall>, kind: string): unknown {
	return lane_breakdown_implement.of(calls, BREAKDOWN).calls?.get(kind)
}

describe('lane_breakdown_implement.of — the calls behind a row', () => {
	it('groups three test:related runs under the test row', () => {
		const calls = [
			bash(11, 2, TEST_RELATED),
			bash(20, 3, `cd /tmp/lane && ${TEST_RELATED}`),
			bash(30, 1, 'pnpm josh test:related'),
			bash(40, 1, 'pnpm josh test:e2e'),
		]

		expect(groups_of(calls, 'test')).toStrictEqual([
			{ label: 'test:related', count: 3, ms: 6 * MINUTE_MS },
			{ label: 'test:e2e', count: 1, ms: MINUTE_MS },
		])
	})

	it('splits the reviewer row into round 1 and the interaction review, each with its level', () => {
		const calls = [
			reviewer(11, 4, { level: MEDIUM }),
			reviewer(11, 6, { level: MEDIUM, pass: 'interaction' }),
			reviewer(40, 2, { type: 'reviewer-verification', level: 'low' }),
		]

		expect(groups_of(calls, REVIEWER)).toStrictEqual([
			{ label: 'interaction · medium', count: 1, ms: 6 * MINUTE_MS },
			{ label: 'round 1 · medium', count: 1, ms: 4 * MINUTE_MS },
		])
		expect(groups_of(calls, 'subagent: reviewer-verification')).toStrictEqual([
			{ label: 'round 2 · low', count: 1, ms: 2 * MINUTE_MS },
		])
	})
})

describe('lane_breakdown_implement.of — the cap', () => {
	it('keeps the three longest groups of a row', () => {
		const calls = [GIT_STATUS, GIT_LOG, 'ls', GH_VIEW].map((command, index) =>
			bash(11 + index * 5, index + 1, command),
		)

		const labels = (
			lane_breakdown_implement.of(calls, BREAKDOWN).calls?.get('other bash') ?? []
		).map((group) => group.label)

		expect(labels).toStrictEqual([GH_VIEW, 'ls', GIT_LOG])
	})
})

describe('lane_breakdown_implement.plan_calls', () => {
	it('prints the three longest calls of the start to plan, none of the implement', () => {
		const calls = [
			bash(1, 1, 'pnpm josh run:entry 5519'),
			bash(2, 3, 'pnpm josh run:prep 5519'),
			call(5, 2, { tool: 'Read' }),
			bash(7, 0.5, GIT_STATUS),
			bash(20, 9, TEST_RELATED),
		]

		expect(lane_breakdown_implement.plan_calls(calls, BREAKDOWN)).toStrictEqual([
			{ label: 'run:prep', count: 1, ms: 3 * MINUTE_MS },
			{ label: 'Read', count: 1, ms: 2 * MINUTE_MS },
			{ label: 'run:entry', count: 1, ms: MINUTE_MS },
		])
	})
})

// joshuafolkken/kit#5712: the row a lane's slow first `lint:related` is read on.
describe('lane_breakdown_implement.plan_calls lint:related detail', () => {
	it('carries the lint:related timing line onto its group and the printed row', () => {
		const calls = [call(1, 7, { command: LINT_RELATED, output: timing_output(LINT_DETAIL) })]

		const groups = lane_breakdown_implement.plan_calls(calls, BREAKDOWN)

		expect(groups).toStrictEqual([
			{ label: LINT_LABEL, count: 1, ms: 7 * MINUTE_MS, detail: LINT_DETAIL },
		])
		expect(groups.map((group) => lane_breakdown_calls.group_text(group))).toStrictEqual([
			`lint:related ×1 7.0 min (${LINT_DETAIL})`,
		])
	})

	it('carries each lint:related group its own longest call timing line', () => {
		const chained_detail =
			'prettier 0.5 s · eslint 2.0 s · 1 file(s) · daemon reused · cache present'
		const calls = [
			call(1, 2, { command: LINT_RELATED, output: timing_output(LINT_DETAIL) }),
			call(4, 5, {
				command: `${LINT_RELATED} && pnpm josh test:related`,
				output: timing_output(chained_detail),
			}),
		]

		expect(lane_breakdown_implement.plan_calls(calls, BREAKDOWN)).toStrictEqual([
			{ label: 'lint:related + test:related', count: 1, ms: 5 * MINUTE_MS, detail: chained_detail },
			{ label: LINT_LABEL, count: 1, ms: 2 * MINUTE_MS, detail: LINT_DETAIL },
		])
	})
})

describe('lane_breakdown_calls.label_of', () => {
	it('cuts a non-josh command to its first 60 characters past a leading cd', () => {
		const long = `node ${'x'.repeat(80)}`

		expect(lane_breakdown_calls.label_of(bash(1, 1, `cd /a/b && ${long}`))).toBe(long.slice(0, 60))
	})

	it('folds a multi-line command onto one line', () => {
		const heredoc = "python3 - <<'EOF'\nimport json\nprint(1)\nEOF"

		expect(lane_breakdown_calls.label_of(bash(1, 1, heredoc))).toBe(
			"python3 - <<'EOF' import json print(1) EOF",
		)
	})

	it('names any other subagent by its type', () => {
		const investigator = call(1, 1, {
			tool: 'Agent',
			subagent: { type: 'investigator', model: undefined },
		})

		expect(lane_breakdown_calls.label_of(investigator)).toBe('investigator')
	})
})

describe('lane_breakdown_calls.label_of — a reserved-run', () => {
	it('names a reserved-run by the program it wrapped, past its runner', () => {
		const lint = 'pnpm josh reserved-run 4 --memory 512 -- pnpm exec eslint --concurrency off .'

		expect(lane_breakdown_calls.label_of(bash(1, 1, lint))).toBe('reserved-run (eslint)')
	})

	it('names a reserved-run by the josh command it wrapped', () => {
		const related = 'cd /a && pnpm josh reserved-run 2 -- pnpm josh test:related'

		expect(lane_breakdown_calls.label_of(bash(1, 1, related))).toBe('reserved-run (test:related)')
	})

	it('keeps a josh command chained after a reserved-run out of what it wrapped', () => {
		const chained = 'pnpm josh reserved-run 1 -- pnpm exec eslint . && pnpm josh test:related'

		expect(lane_breakdown_calls.label_of(bash(1, 1, chained))).toBe(
			'reserved-run (eslint) + test:related',
		)
	})

	it('keeps a josh command chained before a reserved-run in the label', () => {
		const chained = 'pnpm josh lint:related && pnpm josh reserved-run 1 -- npx eslint .'

		expect(lane_breakdown_calls.label_of(bash(1, 1, chained))).toBe(
			'lint:related + reserved-run (eslint)',
		)
	})

	it('keeps a reserved-run that wrapped no command as the bare wrapper', () => {
		expect(lane_breakdown_calls.label_of(bash(1, 1, 'pnpm josh reserved-run --help'))).toBe(
			'reserved-run',
		)
	})
})

describe('lane_breakdown_text.comment — the call lines', () => {
	it('prints each row’s groups under the implement and the start to plan', () => {
		const calls = [
			bash(2, 3, RUN_PREP),
			...[11, 20, 30].map((minute) => bash(minute, 2, TEST_RELATED)),
		]
		const report = {
			breakdown: BREAKDOWN,
			detail: lane_breakdown_implement.of(calls, BREAKDOWN),
			plan_calls: lane_breakdown_implement.plan_calls(calls, BREAKDOWN),
		}
		const lines = lane_breakdown_text.comment(1, 61, report).split('\n')

		expect(lines).toContain('  - test › test:related ×3 6.0 min')
		expect(lines).toContain('  - run:prep ×1 3.0 min')
		expect(lane_breakdown_text.line(report)).not.toContain('test:related ×3')
	})

	it('reads the start to plan calls into the report', () => {
		const calls = [bash(2, 3, RUN_PREP)]
		const read = vi.spyOn(lane_breakdown_implement, 'read').mockReturnValue(calls)

		const report = lane_breakdown_text.report_of(1, BREAKDOWN, [])

		expect(report.plan_calls).toStrictEqual([{ label: 'run:prep', count: 1, ms: 3 * MINUTE_MS }])
		read.mockRestore()
	})
})

describe('lane_breakdown_implement.read — the start to plan window', () => {
	it('reads the calls from the start of the start to plan', () => {
		const spy = vi.spyOn(lane_transcript_stats, 'read_calls').mockReturnValue([])

		lane_breakdown_implement.read(1, BREAKDOWN)

		expect(spy.mock.calls[0]?.[1]).toStrictEqual({ since_ms: PLAN_FROM, until_ms: IMPLEMENT_TO })
		spy.mockRestore()
	})
})

function agent_line(prompt: string): string {
	const input = { subagent_type: 'reviewer', prompt }
	const content = [{ type: 'tool_use', id: 'a', name: 'Agent', input }]

	return JSON.stringify({ timestamp: '2026-10-31T00:00:00Z', message: { content } })
}

const OPENING = 'Review this checkout as a /code-review: read the review brief at'

describe('lane_transcript_calls.parse — a review’s level and pass', () => {
	it.each([
		[
			'an inline interaction brief',
			`${MEDIUM}\nReview.\n## Interaction review\n…`,
			MEDIUM,
			'interaction',
		],
		[
			'a round-1 brief path',
			`${OPENING} /tmp/josh-ship-review-brief-ab.md and follow it`,
			undefined,
			undefined,
		],
		[
			'an interaction brief path',
			`${OPENING} /tmp/josh-ship-review-brief-interaction-ab.md`,
			undefined,
			'interaction',
		],
		[
			'the round-2 prompt',
			'Review this checkout as a /code-review — the round-2 verification pass over',
			undefined,
			'round 2',
		],
		['prose', 'Find X', undefined, undefined],
	])('reads %s', (_kind, prompt, level, pass) => {
		const [parsed] = lane_transcript_calls.parse({ session_id: 's', lane: '1' }, agent_line(prompt))

		expect(parsed?.subagent).toStrictEqual({ type: 'reviewer', model: undefined, level, pass })
	})
})

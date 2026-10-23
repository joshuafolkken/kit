import { agent_session_role } from '#scripts/agent/agent-session-role'
import { cost_cli, type CostVerdict } from '#scripts/cost-runtime/cost-cli'
import { lane_child_marker } from '#scripts/lane/lane-child-marker'
import { lane_handoff } from '#scripts/lane/lane-handoff'
import { lane_paths } from '#scripts/lane/lane-paths'
import { lane_transcript_stats } from '#scripts/lane/lane-transcript-stats'
import { run_board_usage_listing } from '#scripts/run/board/run-board-usage-listing'
import { run_cut } from '#scripts/run/cut/run-cut'
import { run_park } from '#scripts/run/park/run-park'
import { test_declared_changed } from '#scripts/test/test-declared-changed'
import type { Verdict } from '#scripts/test/test-declared-logic'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delivered_rules } from './delivered-rules'
import {
	shell_shape_corpus_fixture,
	type ShapeExpectations,
	type ShellShapeId,
} from './shell-shape-corpus-fixture'
import { shell_shape_readers_fixture } from './shell-shape-readers-fixture'
import { shell_shape_rules_fixture } from './shell-shape-rules-fixture'

const { SHELL_SHAPES } = shell_shape_corpus_fixture
const SHAPE_IDS = Object.keys(SHELL_SHAPES)

const RULE_FIXTURES = [
	shell_shape_rules_fixture.FILING_RULES,
	shell_shape_rules_fixture.GUARD_RULES,
	shell_shape_rules_fixture.LANE_RULES,
]
const RULE_FIRING_SHAPES: Record<string, ReadonlyArray<ShellShapeId>> = Object.fromEntries(
	RULE_FIXTURES.flatMap((rules) => Object.entries(rules)),
)

const LANE_ISSUE = '9'
const OVER_THRESHOLD: CostVerdict = 'over'
const UNTESTED_TREE: Verdict = 'required'

function sorted(keys: ReadonlyArray<string>): Array<string> {
	return keys.toSorted((left, right) => left.localeCompare(right))
}

// A dispatched lane child, uncut, unparked and over its context threshold, on a working tree holding
// an untested runtime change — the world in which every rule that reads the world goes on to read the
// command, so its answer on a shape is about the shape and not about where the test happens to run.
function pin_lane_world(): void {
	vi.spyOn(test_declared_changed, 'current_verdict').mockReturnValue(UNTESTED_TREE)
	vi.spyOn(lane_child_marker, 'is_child_of').mockReturnValue(true)
	vi.spyOn(lane_child_marker, 'marked_issue').mockReturnValue(LANE_ISSUE)
	vi.spyOn(lane_paths, 'lane_issue_of').mockReturnValue(LANE_ISSUE)
	vi.spyOn(lane_handoff, 'is_handed_off').mockReturnValue(false)
	vi.spyOn(run_park, 'is_parked_sync').mockReturnValue(false)
	vi.spyOn(run_cut, 'carried_cut_sync').mockReturnValue(undefined)
	vi.spyOn(agent_session_role, 'is_reviewer').mockReturnValue(false)
	vi.spyOn(cost_cli, 'session_verdict').mockReturnValue(OVER_THRESHOLD)
}

function rule_fires(rule_id: string, command: string): boolean | undefined {
	const rule = delivered_rules.DELIVERED_RULES.find((row) => row.id === rule_id)

	return rule?.is_trigger({ name: 'Bash', input: { command } })
}

function cases_of<T>(answers: ShapeExpectations<T>): Array<[ShellShapeId, string, T]> {
	return Object.entries(SHELL_SHAPES).map(([id, command]) => [
		id as ShellShapeId,
		command,
		answers[id as ShellShapeId],
	])
}

function rule_cases(): Array<[string, ShellShapeId, string, boolean]> {
	return Object.entries(RULE_FIRING_SHAPES).flatMap(([rule_id, firing]) =>
		Object.entries(SHELL_SHAPES).map(([id, command]): [string, ShellShapeId, string, boolean] => [
			rule_id,
			id as ShellShapeId,
			command,
			firing.includes(id as ShellShapeId),
		]),
	)
}

beforeEach(() => {
	pin_lane_world()
})

afterEach(() => {
	vi.restoreAllMocks()
})

describe('the shell shape corpus', () => {
	it('declares an answer set for every delivered rule, and for no rule that is gone', () => {
		const delivered = delivered_rules.DELIVERED_RULES.map((rule) => rule.id)

		expect(sorted(Object.keys(RULE_FIRING_SHAPES))).toStrictEqual(sorted(delivered))
	})

	it('declares each rule in one fixture only', () => {
		const declared = RULE_FIXTURES.flatMap((rules) => Object.keys(rules))

		expect(sorted(declared)).toStrictEqual(sorted(Object.keys(RULE_FIRING_SHAPES)))
	})

	it.each(Object.entries(RULE_FIRING_SHAPES))('%s lists each firing shape once', (_id, firing) => {
		expect(new Set(firing).size).toBe(firing.length)
	})

	it.each([
		['verification commands', shell_shape_readers_fixture.VERIFICATION_COMMANDS],
		['executables', shell_shape_readers_fixture.EXECUTABLES],
	])('the %s reader answers every shape and no other', (_name, answers) => {
		expect(sorted(Object.keys(answers))).toStrictEqual(sorted(SHAPE_IDS))
	})

	it.each(rule_cases())('%s on %s fires as declared', (rule_id, _id, command, fires) => {
		expect(rule_fires(rule_id, command)).toBe(fires)
	})

	it.each(cases_of(shell_shape_readers_fixture.VERIFICATION_COMMANDS))(
		'lane:stats reads the verification commands of %s as declared',
		(_id, command, names) => {
			expect(lane_transcript_stats.verification_commands(command)).toStrictEqual(names)
		},
	)

	it.each(cases_of(shell_shape_readers_fixture.EXECUTABLES))(
		'run:board reads the executable of %s as declared',
		(_id, command, executable) => {
			expect(run_board_usage_listing.executable_of(command)).toBe(executable)
		},
	)
})

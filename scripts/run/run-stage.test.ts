import { describe, expect, it } from 'vitest'
import { run_stage, type StageCommand, type StageState } from './run-stage'

const ISSUE = '3042'

const NO_FACTS = {
	is_closed: false,
	is_prrun_stopped: false,
	is_halfrun_stopped: false,
	is_planned: false,
}

const { REACHED } = run_stage
const PLAN = 'plan'
const IMPLEMENT = 'implement'
const GATE = 'gate'

// (state, command) → start: the whole ladder, one row per state in ladder order.
const STARTS: ReadonlyArray<[StageState, ReadonlyArray<string>]> = [
	[run_stage.FRESH, [PLAN, PLAN, PLAN, PLAN]],
	[run_stage.PLANNED, [REACHED, IMPLEMENT, IMPLEMENT, IMPLEMENT]],
	[run_stage.HALFRUN_STOPPED, [REACHED, REACHED, GATE, GATE]],
	[run_stage.PRRUN_STOPPED, [REACHED, REACHED, REACHED, 'followup']],
	[run_stage.MERGED, [REACHED, REACHED, REACHED, REACHED]],
]

describe('run_stage.decide — the command sets the end, the issue sets the start', () => {
	it.each(STARTS)('starts a run on a %s issue where the ladder says', (state, starts) => {
		const decided = run_stage.COMMANDS.map((command) => run_stage.decide(state, command).start)

		expect(decided).toStrictEqual(starts)
	})

	it('marks a decision reached exactly when its start is reached', () => {
		for (const state of run_stage.STATES) {
			for (const command of run_stage.COMMANDS) {
				const decision = run_stage.decide(state, command)

				expect(decision.is_reached).toBe(decision.start === run_stage.REACHED)
			}
		}
	})

	it('resumes a halfrun stop at the gate and ends a prrun at a green, mergeable PR', () => {
		const decision = run_stage.decide(run_stage.HALFRUN_STOPPED, run_stage.PRRUN)

		expect(decision).toStrictEqual({
			state: run_stage.HALFRUN_STOPPED,
			command: run_stage.PRRUN,
			start: GATE,
			end: 'green, mergeable PR',
			is_reached: false,
		})
	})
})

describe('run_stage.state_of — the furthest rung the facts show', () => {
	it('reads a closed issue as merged whatever its hold says', () => {
		const facts = {
			is_closed: true,
			is_prrun_stopped: true,
			is_halfrun_stopped: true,
			is_planned: true,
		}

		expect(run_stage.state_of(facts)).toBe('merged')
	})

	it.each([
		[
			{ is_prrun_stopped: true, is_halfrun_stopped: true, is_planned: true },
			run_stage.PRRUN_STOPPED,
		],
		[{ is_halfrun_stopped: true, is_planned: true }, run_stage.HALFRUN_STOPPED],
		[{ is_planned: true }, run_stage.PLANNED],
		[{}, run_stage.FRESH],
	])('reads %j as %s', (facts, state) => {
		expect(run_stage.state_of({ ...NO_FACTS, ...facts })).toBe(state)
	})
})

describe('run_stage.next_line — the commands further up the ladder, nearest first', () => {
	it.each([
		['kickoff', 'Next: halfrun #3042 | prrun #3042 | fullrun #3042'],
		['halfrun', 'Next: prrun #3042 | fullrun #3042'],
		['prrun', 'Next: fullrun #3042'],
	])('names what follows %s', (command, line) => {
		expect(run_stage.next_line(command as StageCommand, ISSUE)).toBe(line)
	})

	it('offers nothing further than fullrun', () => {
		expect(run_stage.next_commands('fullrun')).toStrictEqual([])
	})
})

describe('run_stage.format_decision — the stage line run:entry prints first', () => {
	it('names the state, the command and the start', () => {
		const line = run_stage.format_decision(ISSUE, run_stage.decide('planned', 'halfrun'))

		expect(line).toBe('stage #3042 — at: planned · to: halfrun · start: implement')
	})
})

describe('run_stage.to_command — only a ladder command', () => {
	it('accepts each command and refuses anything else', () => {
		for (const command of run_stage.COMMANDS) expect(run_stage.to_command(command)).toBe(command)

		expect(run_stage.to_command('ship')).toBeUndefined()
		expect(run_stage.to_command(undefined)).toBeUndefined()
	})
})

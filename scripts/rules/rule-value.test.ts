import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { rule_value, type RuleReading } from './rule-value'

const TIMESTAMP = '2026-09-09T00:00:00.000Z'
const WIP_CAP = 'wip-cap'
const ISSUE_COMMENTS = 'issue-comments'

const FILING = 'gh api repos/o/r/issues -f title=x'
const COUNT = 'gh api repos/o/r/issues?state=open --jq length'
const BODY_READ = 'gh api repos/o/r/issues/12'
const COMMENTS_READ = 'gh api repos/o/r/issues/12/comments'

// One transcript line carrying one tool call, in the shape `time_transcript_line.parse_line` reads.
function call_line(command: string): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: TIMESTAMP,
		message: {
			id: 'msg_1',
			content: [{ type: 'tool_use', id: 'toolu_1', name: 'Bash', input: { command } }],
		},
	})
}

function result_line(content: string): string {
	return JSON.stringify({
		type: 'user',
		timestamp: TIMESTAMP,
		message: { content: [{ type: 'tool_result', content, is_error: true }] },
	})
}

function session(...commands: ReadonlyArray<string>): string {
	return commands.map((command) => call_line(command)).join('\n')
}

function reading_for(id: string, runs: ReadonlyArray<ReadonlyArray<string>>): RuleReading {
	const found = rule_value.measure(runs).find((reading) => reading.id === id)

	if (found === undefined) throw new Error(`no reading for ${id}`)

	return found
}

describe('rule_value.measure — what the carried text earns unaided', () => {
	it('counts only sessions whose trigger was actually reached', () => {
		expect(reading_for(WIP_CAP, [[session('ls')], [session(FILING)]]).sessions).toBe(1)
	})

	it('reads a run and its delegated units as one timeline, never as separate runs', () => {
		// The parent counted, the unit it delegated filed. Scored per file this is two runs, one of
		// them "trigger reached, not kept"; scored per run it is one run that kept the rule.
		const reading = reading_for(WIP_CAP, [[session(COUNT), session(FILING)]])

		expect(reading.sessions).toBe(1)
		expect(reading.unaided_kept).toBe(1)
	})

	it('credits keeping the rule when it happened before the trigger fired', () => {
		expect(reading_for(WIP_CAP, [[session(COUNT, FILING)]]).unaided_kept).toBe(1)
	})

	it('does not credit compliance that came after the trigger', () => {
		// The refusal is what produced the count here, so it is the delivery's contribution and not
		// the carried text's — the distinction the whole measurement rests on.
		const reading = reading_for(WIP_CAP, [[session(FILING, COUNT)]])

		expect(reading.sessions).toBe(1)
		expect(reading.unaided_kept).toBe(0)
	})

	it('scores the comments rule from a comments read that preceded the body read', () => {
		const kept = reading_for(ISSUE_COMMENTS, [[session(COMMENTS_READ, BODY_READ)]])
		const missed = reading_for(ISSUE_COMMENTS, [[session(BODY_READ)]])

		expect(kept.unaided_kept).toBe(1)
		expect(missed.unaided_kept).toBe(0)
	})
})

describe('rule_value.measure — refusals and unmeasurable rules', () => {
	it('counts a delivered refusal from the reason the hook wrote back', () => {
		const text = `${session(FILING)}\n${result_line(delivered_rules.WIP_CAP_REASON)}`

		expect(reading_for(WIP_CAP, [[text]]).refusals).toBe(1)
	})

	it("does not read another rule's refusal as this one's", () => {
		const text = `${session(FILING)}\n${result_line(delivered_rules.SHELL_BODY_REASON)}`

		expect(reading_for(WIP_CAP, [[text]]).refusals).toBe(0)
	})

	it('does not read a session that merely opened the source file as a refusal', () => {
		// Every signature exists verbatim in `delivered-rules.ts`, so a `Read` of it carries the text
		// in a result whose `is_error` is false. Counting that would inflate the column with sessions
		// that were editing the enumeration rather than being refused by it.
		const read_result = JSON.stringify({
			type: 'user',
			timestamp: TIMESTAMP,
			message: {
				content: [
					{ type: 'tool_result', content: delivered_rules.WIP_CAP_REASON, is_error: false },
				],
			},
		})

		expect(reading_for(WIP_CAP, [[`${session(FILING)}\n${read_result}`]]).refusals).toBe(0)
	})

	it('never reports more refusals than runs that reached the trigger', () => {
		const text = `${session('ls')}\n${result_line(delivered_rules.WIP_CAP_REASON)}`
		const reading = reading_for(WIP_CAP, [[text]])

		expect(reading.refusals).toBeLessThanOrEqual(reading.sessions)
	})
})

describe('rule_value.measure — rules nothing can score', () => {
	it('reports a rule that declares no compliance test as unmeasured, never as zero', () => {
		// Scoring it 0 would read as "never kept", which is a claim the missing predicate cannot make.
		const reading = reading_for('shell-body', [[session('echo hi')]])

		expect(reading.is_measurable).toBe(false)
		expect(rule_value.unaided_rate(reading)).toBeUndefined()
	})

	it('gives no rate for a rule no session reached', () => {
		const reading = reading_for(WIP_CAP, [[session('ls')]])

		expect(rule_value.unaided_rate(reading)).toBeUndefined()
	})

	it('reports the unaided rate as a percentage of the sessions that reached the trigger', () => {
		const runs = [[session(COUNT, FILING)], [session(FILING)], [session(FILING)]]

		expect(rule_value.unaided_rate(reading_for(WIP_CAP, runs))).toBe(33)
	})

	it('survives a line that is not JSON', () => {
		expect(() => rule_value.measure([[`not json\n${session(FILING)}`]])).not.toThrow()
	})

	it('reads every enumerated rule, so a new row is measured rather than silently skipped', () => {
		const ids = rule_value.measure([[session('ls')]]).map((reading) => reading.id)
		const enumerated = delivered_rules.DELIVERED_RULES.map((rule) => rule.id)

		expect(ids).toStrictEqual(enumerated)
	})
})

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

// A rule whose trigger is the violation itself, so it declares `reaches` (joshuafolkken/kit#1643).
const SHELL_BODY = 'shell-body'
const BODY_BY_PATH = 'pnpm josh followup --notify-message-file /tmp/body.md'

// One transcript line carrying one tool call, in the shape `time_transcript_line.parse_line` reads.
function call_line(command: string, timestamp: string = TIMESTAMP): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp,
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

	it('orders a run by timestamp, not by the order its transcripts were handed in', () => {
		// `list_sessions` returns newest first, so the parent that filed can arrive ahead of the unit
		// that counted. Read back to back that scores "trigger reached, not kept"; read as one
		// timeline it is a run that kept the rule.
		const filed = call_line(FILING, '2026-09-09T00:00:09.000Z')
		const counted = call_line(COUNT, '2026-09-09T00:00:01.000Z')
		const reading = reading_for(WIP_CAP, [[filed, counted]])

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
})

// **The denominator is the situation the rule governs, which is its trigger only where that trigger
// is a neutral act** (joshuafolkken/kit#1643).
describe('rule_value.measure — the situation a rule governs', () => {
	it('leaves the denominator at the trigger for a rule that declares no reached-situation test', () => {
		// wip-cap's trigger is the filing, which a run keeping the rule makes too — so a run that
		// counted and never filed never reached the rule at all and must stay out of the denominator.
		expect(reading_for(WIP_CAP, [[session(COUNT)]]).sessions).toBe(0)
	})

	it('counts a run that reached the situation compliantly, though its trigger never fired', () => {
		// shell-body fires only on the violation, so without `reaches` a run that passed every body by
		// path would drop out of the reading and the rate would be taken over runs that broke the rule.
		const reading = reading_for(SHELL_BODY, [[session(BODY_BY_PATH)]])

		expect(reading.sessions).toBe(1)
		expect(reading.unaided_kept).toBe(1)
	})
})

describe('rule_value.measure — the comments rule', () => {
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
		// Every enumerated row declares one since joshuafolkken/kit#1643, so the guarantee is asserted
		// against the reading rather than against whichever row happened to lack a predicate.
		const unmeasured: RuleReading = {
			id: 'unmeasured',
			sessions: 3,
			unaided_kept: 0,
			refusals: 0,
			is_measurable: false,
		}

		expect(rule_value.unaided_rate(unmeasured)).toBeUndefined()
	})

	it('declares a compliance test on every enumerated rule, so none of them reads as unmeasured', () => {
		const readings = rule_value.measure([[session(FILING)]])

		expect(readings.filter((reading) => !reading.is_measurable)).toStrictEqual([])
	})
})

describe('rule_value.measure — the rates it reports', () => {
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

	it('keeps every reason signature distinct, so refusals are not cross-attributed', () => {
		// `observe_refusal` identifies the speaker by the first REASON_SIGNATURE_LENGTH characters. If
		// two reasons ever shared an opening that long, one rule's refusals would be credited to the
		// other with nothing failing.
		const signatures = delivered_rules.DELIVERED_RULES.map((rule) =>
			rule.reason.slice(0, rule_value.REASON_SIGNATURE_LENGTH),
		)

		expect(new Set(signatures).size).toBe(signatures.length)
	})

	it('reads every enumerated rule, so a new row is measured rather than silently skipped', () => {
		const ids = rule_value.measure([[session('ls')]]).map((reading) => reading.id)
		const enumerated = delivered_rules.DELIVERED_RULES.map((rule) => rule.id)

		expect(ids).toStrictEqual(enumerated)
	})
})

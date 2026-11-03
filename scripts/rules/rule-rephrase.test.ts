import { guard_friction_fixture } from '#tools/retrospective/guard-friction-fixture'
import { describe, expect, it } from 'vitest'
import { issue_comments } from './issue-comments'
import { rule_rephrase, type RephraseCounts } from './rule-rephrase'
import { rule_value_cli } from './rule-value-cli'
import { rule_value_fixture } from './rule-value-fixture'

const { bash_call_line, allowed_line, refusal_line } = guard_friction_fixture
const ISSUE_COMMENTS = 'issue-comments'

function rephrased_text(reason: string = issue_comments.ROW.reason): string {
	return [
		bash_call_line(1, 'a'),
		refusal_line(2, 'a', reason),
		bash_call_line(3, 'b'),
		allowed_line(4, 'b'),
	].join('\n')
}

describe('rule_rephrase — the runs a rule refusal was rephrased in, per rule', () => {
	it('counts each run once under the rule whose reason names the refusing guard', () => {
		const counts: RephraseCounts = new Map()

		rule_rephrase.count_run([rephrased_text(), rephrased_text()], counts)
		rule_rephrase.count_run([rephrased_text()], counts)

		expect(rule_rephrase.rephrased_of(ISSUE_COMMENTS, counts)).toBe(2)
		expect(rule_rephrase.rephrased_of('git-force', counts)).toBe(0)
	})

	it('counts a refusal under a former reason under the rule it was renamed to', () => {
		const counts: RephraseCounts = new Map()

		rule_rephrase.count_run([rephrased_text(issue_comments.ROW.former_reasons[0])], counts)

		expect(rule_rephrase.rephrased_of(ISSUE_COMMENTS, counts)).toBe(1)
	})
})

describe('rule_value_cli.row — the rephrased column', () => {
	const reading = rule_value_fixture.reading_for(ISSUE_COMMENTS, [
		[rule_value_fixture.session('ls')],
	])

	it('carries the rule rephrased count where one was taken', () => {
		expect(rule_value_cli.row(reading, 1)).toMatch(/ {2}rephrased 1$/u)
	})

	it('keeps the row shape where no refusal was rephrased', () => {
		expect(rule_value_cli.row(reading)).not.toContain('rephrased')
	})

	it('prints the count in the measured table', () => {
		const { table } = rule_value_cli.render_parts([[rephrased_text()]])
		const line = table.split('\n').find((one) => one.startsWith(ISSUE_COMMENTS))

		expect(line).toMatch(/rephrased 1$/u)
	})
})

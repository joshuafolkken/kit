import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { BREAKING_CHANGE_LABEL } from '#scripts/git/issue-labels'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, describe, expect, it } from 'vitest'
import { scouted_tail } from './delivered-rules-fixture'
import { delivered_rules_harness } from './delivered-rules-harness'
import { issue_bug_label_rule } from './issue-bug-label'
import { rule_delivery } from './rule-guard'

const work = mkdtempSync(path.join(tmpdir(), 'issue-bug-label-rule-'))
const body = path.join(work, 'body.md')
const BUG_BODY = '## 背景\n\n- 種別: 不具合\n'
const OTHER_BODY = '## 背景\n\n- 種別: 非不具合\n- 種別: 振る舞い変更\n'
const BREAKING_DECLARATION = '- 互換性: 破壊的変更'
const ENHANCEMENT_LABEL = 'enhancement'
const FILING = `gh api repos/joshuafolkken/kit/issues -f title=x -F body=@${body}`
const harness = delivered_rules_harness.create_harness('issue-bug-label-guard-')
const lint = time_transcript_fixture.josh_call_line(
	1,
	time_transcript_fixture.BRANCH,
	`pnpm josh issue:lint ${body}`,
)

afterAll(() => {
	harness.cleanup()
	rmSync(work, { recursive: true, force: true })
})

describe('filing a declared bug issue', () => {
	it('refuses a filing without the bug label', () => {
		writeFileSync(body, BUG_BODY)

		expect(issue_bug_label_rule.needs_classification_labels(FILING, lint)).toBe(true)
	})

	it('accepts the bug label alongside route and depth', () => {
		writeFileSync(body, BUG_BODY)

		expect(
			issue_bug_label_rule.needs_classification_labels(
				`${FILING} -f 'labels[]=route:split' -f 'labels[]=depth:1' -f 'labels[]=bug'`,
				lint,
			),
		).toBe(false)
	})

	it('accepts an issue that does not declare a bug', () => {
		writeFileSync(body, OTHER_BODY)

		expect(issue_bug_label_rule.needs_classification_labels(FILING, lint)).toBe(false)
	})

	it('refuses when a different body is submitted after lint', () => {
		writeFileSync(body, OTHER_BODY)

		expect(
			issue_bug_label_rule.needs_classification_labels(
				'gh api repos/o/r/issues -f title=x -f body="- 種別: 不具合"',
				lint,
			),
		).toBe(true)
	})

	it('ignores a fake label flag inside the title', () => {
		writeFileSync(body, BUG_BODY)
		const command = `${FILING} -f "title=example -f labels[]=bug"`

		expect(issue_bug_label_rule.needs_classification_labels(command, lint)).toBe(true)
	})
})

describe('filing an enhancement or breaking change issue', () => {
	it.each([
		{ declaration: '- 目的: 機能追加', label: ENHANCEMENT_LABEL },
		{ declaration: '- 目的: 機能改善', label: ENHANCEMENT_LABEL },
		{ declaration: BREAKING_DECLARATION, label: BREAKING_CHANGE_LABEL },
	])('requires $label at creation for $declaration', ({ declaration, label }) => {
		writeFileSync(body, `${OTHER_BODY}${declaration}\n`)

		expect(issue_bug_label_rule.needs_classification_labels(FILING, lint)).toBe(true)
		expect(
			issue_bug_label_rule.needs_classification_labels(
				`${FILING} -f 'labels[]=route:split' -f 'labels[]=depth:1' -f 'labels[]=${label}'`,
				lint,
			),
		).toBe(false)
	})

	it.each([ENHANCEMENT_LABEL, BREAKING_CHANGE_LABEL])('rejects an unrelated %s label', (label) => {
		writeFileSync(body, OTHER_BODY)

		expect(
			issue_bug_label_rule.needs_classification_labels(`${FILING} -f 'labels[]=${label}'`, lint),
		).toBe(true)
	})

	it('requires both labels when an enhancement breaks compatibility', () => {
		writeFileSync(body, `${OTHER_BODY}- 目的: 機能改善\n${BREAKING_DECLARATION}\n`)
		const enhancement_only = `${FILING} -f 'labels[]=${ENHANCEMENT_LABEL}'`
		const both = `${enhancement_only} -f 'labels[]=${BREAKING_CHANGE_LABEL}'`

		expect(issue_bug_label_rule.needs_classification_labels(enhancement_only, lint)).toBe(true)
		expect(issue_bug_label_rule.needs_classification_labels(both, lint)).toBe(false)
	})

	it('rejects conflicting declarations even when both labels are present', () => {
		writeFileSync(body, `${BUG_BODY}- 目的: 機能改善\n`)
		const filing = `${FILING} -f 'labels[]=bug' -f 'labels[]=enhancement'`

		expect(issue_bug_label_rule.needs_classification_labels(filing, lint)).toBe(true)
	})
})

describe('filing without a bug decision', () => {
	it('refuses an unclassified filing even after lint was called', () => {
		writeFileSync(body, '## 背景\n\n配布済みフックが実行されない。\n')

		expect(issue_bug_label_rule.needs_classification_labels(FILING, lint)).toBe(true)
	})
})

describe('filing without issue:lint', () => {
	it('refuses a filing when issue:lint never ran in the run', () => {
		writeFileSync(body, BUG_BODY)

		expect(
			issue_bug_label_rule.needs_classification_labels(`${FILING} -f 'labels[]=bug'`, ''),
		).toBe(true)
	})

	it('keeps refusing the lint-less filing after the once-per-run oracle has fired', () => {
		writeFileSync(body, BUG_BODY)
		const labeled = `${FILING} -f 'labels[]=bug'`
		const payload = harness.payload_of('no-lint', labeled, 'Bash', scouted_tail())
		const deliveries = [0, 1, 2, 3].map((offset) =>
			rule_delivery(payload, 1_700_000_000_000 + offset),
		)

		expect(deliveries.at(-1)).toBe(issue_bug_label_rule.ROW.reason)
		expect(issue_bug_label_rule.ROW.reason).toContain('pnpm josh issue:lint <body-file>')
	})
})

describe('issue-bug-label delivery', () => {
	it('refuses the unlabeled filing after lint', () => {
		writeFileSync(body, BUG_BODY)
		const history = [scouted_tail(), lint].join('\n')
		const payload = harness.payload_of('missing-label', FILING, 'Bash', history)

		expect(rule_delivery(payload, 1_700_000_000_000)).toBeDefined()
		expect(rule_delivery(payload, 1_700_000_000_001)).toBe(issue_bug_label_rule.ROW.reason)
	})
})

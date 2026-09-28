import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { time_transcript_fixture } from '#scripts/time/time-transcript-fixture'
import { afterAll, describe, expect, it } from 'vitest'
import { scouted_tail } from './delivered-rules-fixture'
import { delivered_rules_harness } from './delivered-rules-harness'
import { issue_bug_label_rule } from './issue-bug-label'
import { rule_delivery } from './rule-guard'

const work = mkdtempSync(path.join(tmpdir(), 'issue-bug-label-rule-'))
const body = path.join(work, 'body.md')
const BUG_BODY = '## 背景\n\n- 種別: 不具合\n'
const OTHER_BODY = '## 背景\n\n- 種別: 振る舞い変更\n'
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

		expect(issue_bug_label_rule.needs_bug_label(FILING, lint)).toBe(true)
	})

	it('accepts the bug label alongside route and depth', () => {
		writeFileSync(body, BUG_BODY)

		expect(
			issue_bug_label_rule.needs_bug_label(
				`${FILING} -f 'labels[]=route:split' -f 'labels[]=depth:1' -f 'labels[]=bug'`,
				lint,
			),
		).toBe(false)
	})

	it('accepts an issue that does not declare a bug', () => {
		writeFileSync(body, OTHER_BODY)

		expect(issue_bug_label_rule.needs_bug_label(FILING, lint)).toBe(false)
	})

	it('refuses when a different body is submitted after lint', () => {
		writeFileSync(body, OTHER_BODY)

		expect(
			issue_bug_label_rule.needs_bug_label(
				'gh api repos/o/r/issues -f title=x -f body="- 種別: 不具合"',
				lint,
			),
		).toBe(true)
	})

	it('ignores a fake label flag inside the title', () => {
		writeFileSync(body, BUG_BODY)
		const command = `${FILING} -f "title=example -f labels[]=bug"`

		expect(issue_bug_label_rule.needs_bug_label(command, lint)).toBe(true)
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

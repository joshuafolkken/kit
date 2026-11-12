import { git_notify } from '#scripts/notify/git-notify'
import { report_labels } from '#scripts/report/report-labels'
import { report_lint_child_summary } from '#scripts/report/report-lint-child-summary'
import { describe, expect, it } from 'vitest'
import { run_tail, type TailSection } from './run-tail'

const OK = 0
const FAILED = 1
const LABEL_CASES = [report_labels.JAPANESE_LABELS, report_labels.ENGLISH_LABELS]
const TARGET_CASES = [[], ['#6234'], ['#6234', '#6235']]

function section(header: string, body: string, code = OK): TailSection {
	return { header, body, code }
}

describe('run_tail.format_report — each step under its own header', () => {
	it('joins the three sections with a blank line', () => {
		const report = run_tail.format_report([
			section(run_tail.OBSERVATIONS_HEADER, 'flushed'),
			section(run_tail.CITATIONS_HEADER, '#2372'),
			section(run_tail.RELEASE_HEADER, 'skip'),
		])

		expect(report).toBe(
			'=== observations ===\nflushed\n\n=== citations ===\n#2372\n\n=== release ===\nskip',
		)
	})
})

describe('run_tail.exit_code — a bundle is clean only when every step was', () => {
	it('exits zero when all three succeeded', () => {
		expect(run_tail.exit_code([section('a', '', OK), section('b', '', OK)])).toBe(OK)
	})

	it('exits non-zero when any step failed', () => {
		expect(run_tail.exit_code([section('a', '', OK), section('b', '', FAILED)])).toBe(FAILED)
	})
})

describe('run_tail.template_sections', () => {
	it.each(LABEL_CASES)(
		'prints lint-clean child and notification skeletons (ac-25ca12b0) (ac-55a49338)',
		(labels) => {
			for (const issues of TARGET_CASES) {
				const sections = run_tail.template_sections(issues, labels)

				expect(sections.map((entry) => entry.header)).toEqual([
					'=== child summary template ===',
					'=== notify-message template ===',
				])

				for (const entry of sections) {
					expect(report_lint_child_summary.lint_child_summary(entry.body, labels)).toEqual([])
					expect(entry.body).toContain(`- **${labels.cause}**: <…>`)
					expect(entry.body).toContain(`- **${labels.fix}**: <…>`)
					expect(entry.body).toContain(`- **${labels.result}**: <…>`)
				}
			}
		},
	)

	it('seeds the result with all cited run targets without claiming completion', () => {
		const sections = run_tail.template_sections(['#6234', '#6235'], report_labels.ENGLISH_LABELS)

		expect(sections[0]?.body).toContain('- **Result**: <…> (#6234, #6235)')
		expect(run_tail.exit_code(sections)).toBe(OK)
	})

	it('supplies the notification body accepted by followup (ac-5a6c24c5)', () => {
		const sections = run_tail.template_sections([], report_labels.ENGLISH_LABELS)
		const message = sections.at(-1)?.body
		const config = git_notify.build_notify_config({
			raw_target: 'issue',
			raw_message: message,
			raw_mentions: undefined,
		})

		expect(config?.message).toBe('- **Cause**: <…>\n- **Fix**: <…>\n- **Result**: <…>')
	})
})

import { describe, expect, it } from 'vitest'
import { issue_filing_args } from './issue-filing-args'

const BODY_FILE = '/path/to/issue.md'

describe('issue filing arguments', () => {
	it('reads a body file from the gh api field', () => {
		expect(issue_filing_args.body_file(`gh api repos/o/r/issues -F 'body=@${BODY_FILE}'`)).toBe(
			BODY_FILE,
		)
	})

	it('reads gh issue create body-file and label options', () => {
		const command = `gh issue create --title x --body-file ${BODY_FILE} --label bug`

		expect(issue_filing_args.body_file(command)).toBe(BODY_FILE)
		expect(issue_filing_args.has_label(command, 'bug')).toBe(true)
	})

	it('does not count label syntax inside a quoted title or body', () => {
		const command =
			'gh api repos/o/r/issues -f "title=example -f labels[]=bug" -f "body=-f labels[]=bug"'

		expect(issue_filing_args.has_label(command, 'bug')).toBe(false)
	})

	it('recognizes a separate label field', () => {
		const command = `gh api repos/o/r/issues -F body=@${BODY_FILE} -f 'labels[]=bug'`

		expect(issue_filing_args.has_label(command, 'bug')).toBe(true)
	})

	it('rejects a second body field that could replace the checked file', () => {
		const command = `gh api repos/o/r/issues -F body=@${BODY_FILE} -f body=other`

		expect(issue_filing_args.body_file(command)).toBeUndefined()
	})
})

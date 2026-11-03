import { describe, expect, it } from 'vitest'
import { claude_settings_fixture } from './claude-settings-fixture'

const { load_settings } = claude_settings_fixture

// A `pull_request` run executes the branch's own workflow files, so a rewritten workflow can turn a
// required check green. `pretool-guard` refuses a lane child's edit (joshuafolkken/kit#6050); these
// entries are the static backstop for a hook that did not run (joshuafolkken/kit#6067).
const WORKFLOW_EDIT_DENY_PATTERNS: ReadonlyArray<string> = [
	'Edit(./.github/workflows/**)',
	'Write(./.github/workflows/**)',
]

describe('.claude/settings.json — workflow edit deny', () => {
	it.each(WORKFLOW_EDIT_DENY_PATTERNS)('denies the file tool %s', (pattern) => {
		expect(load_settings().permissions.deny).toContain(pattern)
	})

	it('leaves reading a workflow file open', () => {
		const settings = load_settings()

		expect(settings.permissions.deny.filter((entry) => entry.includes('.github'))).toStrictEqual(
			WORKFLOW_EDIT_DENY_PATTERNS,
		)
	})
})

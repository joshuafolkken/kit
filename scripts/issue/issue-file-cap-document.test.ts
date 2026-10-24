import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { issue_file_cap } from './issue-file-cap'

// joshuafolkken/kit#4750: the filing ceiling's unit is the one `issue:file` counts — an originating
// work item, read off the run's event stream. Prose that counted it per run or per invocation describes
// a count nothing enforces.

const STEPS_DOC = '.claude/skills/workflow-commands/backlogrun-steps.md'
const PER_RUN_PATTERN = /ten[- ](?:filings[- ])?per[- ](?:run|invocation)/iu

const PER_ORIGIN_DOCS = [
	'.claude/skills/workflow-commands/retrospective.md',
	'docs/maintainers/backlogrun-steps-rationale.md',
]

const CEILING_DOCS = [
	...PER_ORIGIN_DOCS,
	STEPS_DOC,
	'.claude/skills/workflow-commands/prerequisite.md',
	'.claude/skills/workflow-commands/observation-filing.md',
]

describe('issue_file_cap counts per originating work item', () => {
	it('names the per-origin ceiling in its refusal', () => {
		expect(issue_file_cap.reason_of(undefined)).toContain('per originating work item')
	})

	it('caps at ten', () => {
		expect(issue_file_cap.FILING_CAP).toBe(10)
	})
})

describe.each(PER_ORIGIN_DOCS)('%s states the ceiling per origin', (path) => {
	it('names the per-origin ceiling', () => {
		expect(read_repo_file(path)).toContain('ten-per-origin')
	})
})

describe.each(CEILING_DOCS)('%s does not count the ceiling per run', (path) => {
	it('has no per-run or per-invocation ceiling', () => {
		expect(read_repo_file(path)).not.toMatch(PER_RUN_PATTERN)
	})
})

describe('backlogrun-steps.md names the step that counts the ceiling', () => {
	it('points at issue-file-cap', () => {
		const steps = read_repo_file(STEPS_DOC)

		expect(steps).toContain('**Ten filings per originating work item**')
		expect(steps).toContain('scripts/issue/issue-file-cap.ts')
	})
})

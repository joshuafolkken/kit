import { read_repo_file } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { filing_cap } from './filing-cap'

// joshuafolkken/kit#4155: the filing ceiling's unit is the one `filing-cap` counts — a run, read off
// the session transcript. Prose that called it per invocation described a count nothing enforces.

const PER_RUN = 'ten-per-run'
const STEPS_DOC = '.claude/skills/workflow-commands/backlogrun-steps.md'
const PER_INVOCATION_PATTERN = /ten[- ](?:filings[- ])?per[- ]invocation/iu

const PER_RUN_DOCS = [
	'.claude/skills/workflow-commands/retrospective.md',
	'docs/maintainers/backlogrun-steps-rationale.md',
]

const CEILING_DOCS = [...PER_RUN_DOCS, STEPS_DOC]

describe('filing-cap counts per run', () => {
	it('names the per-run ceiling in its refusal', () => {
		expect(filing_cap.FILING_CAP_REASON).toContain('per-run ceiling')
	})

	it('caps at ten', () => {
		expect(filing_cap.FILING_CAP).toBe(10)
	})
})

describe.each(PER_RUN_DOCS)('%s states the ceiling per run', (path) => {
	it('names the per-run ceiling', () => {
		expect(read_repo_file(path)).toContain(PER_RUN)
	})
})

describe.each(CEILING_DOCS)('%s does not count the ceiling per invocation', (path) => {
	it('has no per-invocation ceiling', () => {
		expect(read_repo_file(path)).not.toMatch(PER_INVOCATION_PATTERN)
	})
})

describe('backlogrun-steps.md names the guard that counts the ceiling', () => {
	it('points at filing-cap', () => {
		const steps = read_repo_file(STEPS_DOC)

		expect(steps).toContain('**Ten filings per run**')
		expect(steps).toContain('scripts/rules/filing-cap.ts')
	})
})

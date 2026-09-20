import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { CONTEXT_CUT_THRESHOLD } from './context-cut-threshold'

// joshuafolkken/kit#2133: prose in skill files and docs states the context-cut threshold value.
// Drifting the constant without updating the docs (or vice versa) fails here rather than being
// caught by a reader who compares the two manually. The bash output cap and entry-read figure
// are pinned separately so a bulk replace cannot silently sweep them up.

const THRESHOLD_RAW = CONTEXT_CUT_THRESHOLD
const THRESHOLD_COMMA = new Intl.NumberFormat('en-US').format(THRESHOLD_RAW)
const THRESHOLD_UNDERSCORE = THRESHOLD_COMMA.replaceAll(',', '_')

const BASH_OUTPUT_CAP_UNDERSCORE = '150_000'
const OUTPUT_BOUNDS_CAP_COMMA = '150,000'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

function read_repo_file(relative_path: string): string {
	return readFileSync(`${REPO_ROOT}/${relative_path}`, 'utf8')
}

function contains_threshold(content: string): boolean {
	return content.includes(THRESHOLD_COMMA) || content.includes(THRESHOLD_UNDERSCORE)
}

const CONTEXT_CUT_DOCS = [
	'.claude/skills/workflow-commands/SKILL.md',
	'.claude/skills/workflow-commands/backlogrun-progress.md',
	'.claude/skills/workflow-commands/fullrun.md',
	'.claude/skills/workflow-commands/halfrun.md',
	'.claude/skills/workflow-commands/pre-gate-cut.md',
	'docs/josh-commands.md',
]

describe.each(CONTEXT_CUT_DOCS)('%s states the context-cut threshold', (path) => {
	it('contains the current threshold value', () => {
		expect(contains_threshold(read_repo_file(path))).toBe(true)
	})
})

describe('bash output cap and entry-read figure stay at 150,000', () => {
	it('bash-output-cap.test.ts pins the Bash output cap at 150_000', () => {
		expect(read_repo_file('scripts/lib/bash-output-cap.test.ts')).toContain(
			BASH_OUTPUT_CAP_UNDERSCORE,
		)
	})

	it('output-bounds.md documents the Bash output cap as 150,000', () => {
		expect(read_repo_file('prompts/collaboration-workflow/output-bounds.md')).toContain(
			OUTPUT_BOUNDS_CAP_COMMA,
		)
	})
})

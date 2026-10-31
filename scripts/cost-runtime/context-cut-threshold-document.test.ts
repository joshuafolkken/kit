import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2133: prose in skill files and docs states the context-cut threshold. Since
// joshuafolkken/kit#5341 the threshold is priced at the session's model, so no fixed figure is right
// for every run — the docs name the command that prints it, and the old fixed figure is pinned out
// so a doc cannot keep telling one model another's number. The bash output cap is pinned separately
// so a bulk replace cannot silently sweep it up.

const CUT_COMMAND = '`pnpm josh cost --cut`'
const STALE_FIXED_THRESHOLDS = ['135,000', '135_000']

const BASH_OUTPUT_CAP_UNDERSCORE = '150_000'
const OUTPUT_BOUNDS_CAP_COMMA = '150,000'

const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

function read_repo_file(relative_path: string): string {
	return readFileSync(`${REPO_ROOT}/${relative_path}`, 'utf8')
}

const CONTEXT_CUT_DOCS = [
	'.claude/skills/workflow-commands/SKILL.md',
	'.claude/skills/workflow-commands/backlogrun-progress.md',
	'.claude/skills/workflow-commands/entry-sequence.md',
	'.claude/skills/workflow-commands/pre-gate-cut.md',
	'.claude/skills/workflow-commands/retrospective.md',
	'docs/josh-commands-run.md',
]

// joshuafolkken/kit#4155: `retrospective.md` stated the Bash output cap's figure as a session
// budget beside the threshold everywhere else.
const STALE_SESSION_BUDGET = '150,000-token'

describe.each(CONTEXT_CUT_DOCS)('%s names the context-cut threshold', (path) => {
	it('names the command that prices it', () => {
		expect(read_repo_file(path)).toContain(CUT_COMMAND)
	})

	it.each(STALE_FIXED_THRESHOLDS)('spells no fixed %s threshold', (literal) => {
		expect(read_repo_file(path)).not.toContain(literal)
	})

	it('does not state the stale session budget', () => {
		expect(read_repo_file(path)).not.toContain(STALE_SESSION_BUDGET)
	})
})

describe('bash output cap stays at 150,000', () => {
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

import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'
import { ALIASES, COMMAND_MAP } from './josh/josh-command-map'

// joshuafolkken/kit#1257: the scoped unit check only saves anything if a run reaches for it, and a
// run reaches for whichever command the implementation-loop row names. Registration and that row
// are therefore asserted together — a command nothing points at is 93% of the unit suite's CPU left
// on the table, and a row pointing at a command that does not exist is a failed re-check.

const COMMAND_NAME = 'test:related'
const SCRIPT_PATH = 'scripts/test-related.ts'
const ALIAS = 'tr'

// The full suite is what the gate runs before the commit. A document that swapped this one for the
// scoped command would narrow the run a merge rests on, which is the inversion this whole change is
// written not to make.
const FULL_SUITE_COMMAND = 'pnpm josh test:unit'
const SCOPED_COMMAND = 'pnpm josh test:related'

describe(`josh ${COMMAND_NAME} is registered`, () => {
	it('routes through the related-scope script', () => {
		expect(COMMAND_MAP[COMMAND_NAME]?.script).toBe(SCRIPT_PATH)
	})

	it('is reachable by its alias', () => {
		expect(ALIASES[ALIAS]).toBe(COMMAND_NAME)
	})
})

// One row is the rule's single source and the rest point at it, so each is asserted where a run
// actually reads it: an entry file is read on its own, and a run following its procedure literally
// never opens the review prompt.
const REVIEW_PROMPT = 'prompts/review.md'

const IMPLEMENTATION_LOOP_DOCUMENTS: ReadonlyArray<string> = [
	// The resident rules text is the only one a change made outside a workflow has in context — "fix
	// this wording" is the common one — so a loop that never loads a skill reads the command here.
	'CLAUDE.md',
	REVIEW_PROMPT,
	'prompts/collaboration-workflow/plan-comment.md',
	'.claude/skills/workflow-commands/SKILL.md',
	'.claude/skills/workflow-commands/fullrun.md',
	'.claude/skills/workflow-commands/halfrun.md',
]

describe('the implementation loop names the scoped unit check', () => {
	it.each(IMPLEMENTATION_LOOP_DOCUMENTS)('%s names it', (document_path) => {
		expect(read_unwrapped(document_path)).toContain(SCOPED_COMMAND)
	})
})

// The three sentences that keep the scoped run from being read as a replacement: what it narrows
// by, that the gate is unchanged, and that an unreadable change list runs everything rather than
// nothing.
const REVIEW_PROMPT_MARKERS: ReadonlyArray<string> = [
	'**The unit check in the first row is the scoped one**',
	'falls back to the whole suite',
	`\`${FULL_SUITE_COMMAND}\` is unchanged as what \`pnpm josh gate\` runs`,
]

describe(`${REVIEW_PROMPT} — the scoped check is defined, not merely named`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(REVIEW_PROMPT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('keeps the gate on the full suite', () => {
		expect(content).toContain(FULL_SUITE_COMMAND)
	})
})

const COMMAND_DOC = 'docs/josh-commands.md'

const COMMAND_DOC_MARKERS: ReadonlyArray<string> = [
	`### \`josh ${COMMAND_NAME}\``,
	'**It is added in front of the whole suite, never in place of it.**',
	'**It prints what it narrowed by before it runs**',
	'the changed files could not be read',
	'no changed file is one a test can import',
]

describe(`${COMMAND_DOC} — the command reference documents the fallbacks`, () => {
	const content = read_unwrapped(COMMAND_DOC)

	it.each(COMMAND_DOC_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

import { read_unwrapped } from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'

// joshuafolkken/kit#1319: **the place a run is told to write was the place it was never told to
// read.** This repository records a Tier A decision, a dropped review finding, a split agreement and
// a batch decision's answer as Issue *comments*, while every `#N` entry point was told only to read the
// Issue. A body never says it has been superseded, so the mistake is silent: on
// joshuafolkken/kit#1304 neither review round, nor the verification gate, nor CI noticed that part of
// the work had been handed to joshuafolkken/kit#1307 seventeen minutes before implementation began.
//
// **The rule has two halves and both have to hold.** The procedure lives in the workflow skill,
// because a session that runs no hooks — Codex, Gemini CLI, Cursor, a Claude Code with the switch
// off — still owes the read; the delivered row makes it hard to walk past inside Claude Code. A
// suite over one half would let the other be reverted while this stayed green.
//
// Every marker is matched against `read_unwrapped`, so a hand-wrap moved by a formatter does not
// fail a test for a reason that has nothing to do with the rule.

const WORKFLOW_SKILL = '.claude/skills/workflow-commands/SKILL.md'
const FULLRUN_SKILL = '.claude/skills/workflow-commands/fullrun.md'
const HALFRUN_SKILL = '.claude/skills/workflow-commands/halfrun.md'
const KICKOFF_SKILL = '.claude/skills/workflow-commands/kickoff.md'
const DELIVERY_TOPIC = 'prompts/collaboration-workflow/rule-delivery.md'
const GUARD_DOC = 'docs/josh-commands.md'

const ENTRY_POINTS = [FULLRUN_SKILL, HALFRUN_SKILL, KICKOFF_SKILL]
// The portable spelling. `gh issue view <N> --comments` is GraphQL-backed and a cloud session is
// answered 403, which `scripts/gh/gh-document-guard.test.ts` enforces for runnable blocks — so the REST
// call is what the procedure has to name. It is the read itself, so a trim keeps it.
const REST_READ = 'gh api repos/{owner}/{repo}/issues/<N>/comments'
// The stop answer that is not the run's to make. Stated once, in §2g, so an entry point that restated
// it would be the clone `CLAUDE.md` prohibits.
const STOP_ANSWER = 'no longer has a reason to exist'

// joshuafolkken/kit#1959: §2g's story and rationale moved out (joshuafolkken/kit#1925 trims the
// section to its rule). joshuafolkken/kit#2189 relocated the §2g body to `issue-comments.md`, leaving
// the `SKILL.md` §2g stub as a trigger and pointer; the portable comment read the rule cannot lose now
// lives in that companion, and the entry points still point at the single source rather than restating
// it.
const ISSUE_COMMENTS_DOC = '.claude/skills/workflow-commands/issue-comments.md'

describe('§2g — the procedure every `#N` entry point owes', () => {
	it('names the portable comment read in its single source', () => {
		expect(read_unwrapped(ISSUE_COMMENTS_DOC)).toContain(REST_READ)
	})

	it('leaves the SKILL.md stub pointing at the companion', () => {
		expect(read_unwrapped(WORKFLOW_SKILL)).toContain('issue-comments.md')
	})
})

describe('the `#N` entry points point at the procedure', () => {
	// An entry point owes the pointer, not a second copy: the conflict rule and its stop answers are
	// stated once, in §2g, so a change to them cannot leave two files disagreeing.
	it.each(ENTRY_POINTS)('%s points at §2g rather than restating it', (document) => {
		const content = read_unwrapped(document)

		expect(content).toContain('§2g')
		expect(content).not.toContain(STOP_ANSWER)
	})
})

describe('the delivered row that makes the step hard to walk past', () => {
	it('is enumerated, so the refusal has somewhere to come from', () => {
		expect(delivered_rules.DELIVERED_RULES.map((rule) => rule.id)).toContain('issue-comments')
	})

	// A read that already carries the comments must pass, or obeying the rule would wedge the run.
	it('fires on the body-only read and not on the read it asks for', () => {
		expect(delivered_rules.is_body_only_issue_read('gh issue view 1319')).toBe(true)
		expect(delivered_rules.is_body_only_issue_read('gh issue view 1319 --comments')).toBe(false)
	})

	// The hook reaches Claude Code alone, so the documents have to describe a rule that outlives it.
	it.each([DELIVERY_TOPIC, GUARD_DOC])('%s documents the trigger', (document) => {
		expect(read_unwrapped(document)).toContain('…/issues/<N>')
	})
})

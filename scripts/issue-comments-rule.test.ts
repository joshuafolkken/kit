import { delivered_rules } from '#scripts/rules/delivered-rules'
import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1319: **the place a run is told to write was the place it was never told to
// read.** This repository records a Tier A decision, a dropped review finding, a split agreement and
// an `epic:plan` answer as Issue *comments*, while every `#N` entry point was told only to read the
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
// The phrase each entry point owes. It is the read itself, not a reminder about it.
const ENTRY_MARKER = 'every comment on it'
// The portable spelling. `gh issue view <N> --comments` is GraphQL-backed and a cloud session is
// answered 403, which `scripts/gh-document-guard.test.ts` enforces for runnable blocks — so the REST
// call is what the procedure has to name.
const REST_READ = 'gh api repos/{owner}/{repo}/issues/<N>/comments'
// The one sentence that decides a contradiction, and the two answers that are not the run's to make.
// Without them the delivery hands the deciding back to judgement at the moment nothing else is open
// to read — the failure joshuafolkken/kit#1518 corrected for the WIP cap.
const CONFLICT_RULE = 'The later text is the agreement in force'
const STOP_ANSWER = 'no longer has a reason to exist'

const PROCEDURE_MARKERS: ReadonlyArray<string> = [
	"An Issue's comments are part of the Issue",
	REST_READ,
	CONFLICT_RULE,
	'reassigns part of the scope to another Issue',
	STOP_ANSWER,
	'`confirmation` Telegram',
	// Why the reading is made, so it is not skimmed into a formality.
	'the boundary of the scope',
	'joshuafolkken/kit#1304',
]

describe('SKILL.md §2g — the procedure every `#N` entry point owes', () => {
	const content = read_unwrapped(WORKFLOW_SKILL)

	it.each(PROCEDURE_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// A long thread is answered by the delegation rule already in §2b rather than by a second rule,
	// and the projection is what keeps the fetch from being carried whole on every later turn.
	it('says what a long thread costs and where it goes', () => {
		expect(content).toContain('§2b')
		expect(content).toContain('the comment URLs that')
	})
})

describe('the `#N` entry points carry the step and point at the procedure', () => {
	it.each(ENTRY_POINTS)('%s makes the comments part of the read', (document) => {
		expect(read_unwrapped(document)).toContain(ENTRY_MARKER)
	})

	// **The counter-assertion, because three copies of a procedure is the clone `CLAUDE.md`
	// prohibits.** An entry point owes the step and the pointer; the conflict rule and its two stop
	// answers are stated once, in §2g, so a change to them cannot leave two files disagreeing.
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

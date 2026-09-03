import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1246: joshuafolkken/kit#1242 decided *when* one gate starts and left *how many*
// gates a run pays for untouched. Measured on joshuafolkken/kit#1241, that count was the larger half
// — ten gate runs, 8.2 minutes of a 49.1-minute run, six of them before the review had started and
// every one of those six answered by a single check.
//
// Each marker below is one place a run reads the rule from. Dropping any of them restores the habit
// this change removes: the entry files are read on their own, so a rule stated only in the skill's
// shared bullet never reaches a run following its own procedure literally, and one stated only in
// English never reaches the canonical Japanese topic.
const REVIEW_PROMPT = 'prompts/review.md'
const GATE_BULLET = '.claude/skills/workflow-commands/SKILL.md'
const FULLRUN = '.claude/skills/workflow-commands/fullrun.md'
const HALFRUN = '.claude/skills/workflow-commands/halfrun.md'
const PLAN_COMMENT = 'prompts/collaboration-workflow/plan-comment.md'
const DOCS = 'docs/josh-commands.md'

// The heading the rule lives under, so a document that does not carry the table names where it is.
const SECTION_POINTER = 'The gate runs beside this review, not in front of it'

// The rule's single source: the count, the mechanical criterion that decides which command to run,
// and the sentence that keeps the join from being read as weakened. The third is load-bearing — a
// reader who takes "fewer gates" as "the commit needs no gate" has inverted the change.
const REVIEW_PROMPT_MARKERS: ReadonlyArray<string> = [
	'**The gate is started once per run, not once per edit**',
	'**Which command to run is decided by whether the review has started, and by nothing else.**',
	'**The single check by name**',
	'**The criterion is the review, not the tree.**',
	'**Nothing here weakens the join**',
]

describe(`${REVIEW_PROMPT} — the count rule is defined`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(REVIEW_PROMPT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The one sentence every implementing entry has to carry in its own file, plus the skill's shared
// verification-gate bullet. Asserted per file for the reason above: each is read on its own.
const ONCE_PER_RUN = 'once per run, not once per edit'
const SINGLE_CHECK = 're-run the single check by name'

const PROCEDURE_FILES: ReadonlyArray<string> = [FULLRUN, HALFRUN]

describe('every implementing entry says the gate is started once per run', () => {
	it.each(PROCEDURE_FILES)('%s says so in its own procedure', (path) => {
		const content = read_unwrapped(path)

		expect(content).toContain(ONCE_PER_RUN)
		expect(content).toContain(SINGLE_CHECK)
	})
})

const GATE_BULLET_MARKERS: ReadonlyArray<string> = [
	'**That gate is started once per run, not once per edit**',
	'never by how large the edit was',
]

describe(`${GATE_BULLET} — the gate bullet carries the count`, () => {
	const content = read_unwrapped(GATE_BULLET)

	it.each(GATE_BULLET_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The canonical Japanese topic states the same loop without reading `prompts/review.md` first, so a
// run following it literally would keep paying for a gate per edit while the skill said not to.
describe(`${PLAN_COMMENT} — the canonical topic agrees`, () => {
	it.each([
		'**そのゲートは 1 ラン 1 回であって、1 編集 1 回ではない**',
		'**実装中は、単一チェックを名前で回す**',
		'**「レビューが始まったか」**だけで決まり',
	])('states %j', (marker) => {
		expect(read_unwrapped(PLAN_COMMENT)).toContain(marker)
	})
})

// The resident completion gate is the only rules text a change made outside a workflow has in
// context — "fix this wording" is the common one — so without the count there, such a turn keeps
// paying for a gate per edit while every skill says not to.
describe('CLAUDE.md — the resident completion gate carries the count', () => {
	it('states the rule where a run with no skill loaded reads it', () => {
		expect(read_unwrapped('CLAUDE.md')).toContain('**One gate per run, not one per edit**')
	})
})

// The command reference is where the header line that names the single command is documented; it is
// what the first row of the rule's table tells a run to copy from.
describe(`${DOCS} — the command reference points at the rule`, () => {
	it.each([
		'**That single re-run is what an implementation loop is meant to use, and the whole gate is not.**',
		SECTION_POINTER,
	])('states %j', (marker) => {
		expect(read_unwrapped(DOCS)).toContain(marker)
	})
})

// Single-sourcing, asserted rather than assumed: the branch table lives in `prompts/review.md` and
// the other documents point at it. A copy in an entry file is how the two drift apart, and a rule
// that says two different things in two files is worse than one stated once.
const TABLE_HEADER = '| Where the run is'
const NEVER_COPIES: ReadonlyArray<string> = [GATE_BULLET, FULLRUN, HALFRUN, PLAN_COMMENT, DOCS]
// The three documents that state the loop far enough from the rule to need the section named. The
// two entry files are not among them: they carry the one sentence a run has to obey and reach the
// table through the skill bullet they already read, so a second pointer there would be text every
// run loads for nothing.
const NAMES_THE_SECTION: ReadonlyArray<string> = [GATE_BULLET, PLAN_COMMENT, DOCS]

describe('the branch table is stated once', () => {
	it('lives in the review prompt', () => {
		expect(read_unwrapped(REVIEW_PROMPT)).toContain(TABLE_HEADER)
	})

	it.each(NEVER_COPIES)('%s does not copy it', (path) => {
		expect(read_unwrapped(path)).not.toContain(TABLE_HEADER)
	})

	it.each(NAMES_THE_SECTION)('%s names the section instead', (path) => {
		expect(read_unwrapped(path)).toContain(SECTION_POINTER)
	})
})

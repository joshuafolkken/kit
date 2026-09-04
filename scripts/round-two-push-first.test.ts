import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1326: joshuafolkken/kit#1261 moved the commit between the two review rounds, so
// the first CI cycle overlapped round 2 — and stopped there. The round's own fix commit still waited
// for a full `josh gate` before it was pushed, so the second CI cycle could not start until the gate
// had finished. Reconstructed on joshuafolkken/kit#1299: 6 minutes 34 seconds between a green first
// cycle and the merge, every second of it serial — a red gate (51s), a green one (50s), the push
// (30s), then the second cycle (149s).
//
// The correction pushes the fix commit first and runs its gate beside that cycle. Each marker pins
// one half of what keeps the reorder from being a weakening, and dropping any one puts back the
// state it exists to remove:
//
//   - without the scoped check in front, the run keeps discovering a lint violation by paying for a
//     red full gate, which is the most expensive way to learn it;
//   - without the join before `followup --merge`, the local gate becomes advisory and a merge can be
//     decided on a gate nobody read — the obligation moved, not removed;
//   - without the red-gate paragraph, the cost of a superseded CI cycle is undocumented and reads as
//     unbounded, when `ci.yml`'s concurrency group cancels it;
//   - without the merge-condition sentence, the change reads as relaxing what the merge blocks on.
const REVIEW_PROMPT = 'prompts/review.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const FULLRUN = '.claude/skills/workflow-commands/fullrun.md'
const QUEUE = '.claude/skills/workflow-commands/queue.md'
const HALFRUN = '.claude/skills/workflow-commands/halfrun.md'
const PLAN_COMMENT = 'prompts/collaboration-workflow/plan-comment.md'
const COMMANDS_DOC = 'docs/josh-commands.md'

// The heading every other document cites, so a shortened pointer still resolves to one section.
const SECTION_POINTER = 'The round-2 fix commit is pushed before its gate'

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	`### ${SECTION_POINTER}, so its CI runs beside it`,
	'**So a fix the second round makes in place is pushed before its gate, and the gate runs inside the CI wait instead of in front of it.**',
	'**Pushing before the gate is not pushing unverified code, and two mechanisms are why.**',
	'**Step 3 is still not optional, and the join is where the rule holds.**',
	'**A red gate here costs one superseded CI cycle, and `ci.yml` bounds what that costs.**',
	'**Every merge condition is the one it was.**',
]

describe(`${REVIEW_PROMPT} — the single source states the new order`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(CANONICAL_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The three steps, asserted where a run reads them rather than only in the prose above. A file that
// carries one of them and not the others describes half an order.
const PUSHED_FIRST = 'is pushed before its gate'

const ORDER_MARKERS: ReadonlyArray<string> = [
	PUSHED_FIRST,
	'the single check the fix reaches',
	'joined before `pnpm josh followup --merge`',
	'no second `bump`',
]

// Every file a run follows on its own. Asserted per file because each is read alone: an order stated
// only in the skill's shared bullet never reaches an entry following its own procedure literally.
const ENTRY_FILES: ReadonlyArray<string> = [SKILL, CHAIN_RULE, FULLRUN, QUEUE]

describe('every entry that commits states the three steps in its own file', () => {
	it.each(ENTRY_FILES)('%s states them', (path) => {
		const content = read_unwrapped(path)

		for (const marker of ORDER_MARKERS) expect(content).toContain(marker)
	})
})

// The order the change replaces. It read as an instruction, so a surviving copy tells a run to hold
// the commit back for the gate at the exact point this change sends it out first. It was written two
// ways, and each is guarded only where it actually occurred — a guard pointed at a file that never
// carried the spelling passes without asserting anything, which is how the copy in the other
// spelling survived the first round of this change.
const RETIRED_SPELLINGS: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
	['its own `pnpm josh gate` join', [SKILL, FULLRUN, QUEUE]],
	['its own gate join', [REVIEW_PROMPT, CHAIN_RULE]],
]

describe('the gate-before-push order is gone', () => {
	it.each(RETIRED_SPELLINGS)('%j is gone from every file that carried it', (spelling, paths) => {
		for (const path of paths) expect(read_unwrapped(path)).not.toContain(spelling)
	})
})

// `halfrun` stops before the commit, so it has no pull request, no CI cycle and nothing to push
// ahead of a gate. Asserted as an absence because the wording is easy to copy across when the entry
// files are edited together.
describe(`${HALFRUN} — the stop before commit is untouched`, () => {
	it('never claims a fix is pushed before its gate', () => {
		expect(read_unwrapped(HALFRUN)).not.toContain(PUSHED_FIRST)
	})
})

// The canonical Japanese topic, which is what a non-Claude agent following the workflow prompt
// reaches without ever opening `prompts/review.md`. Left unchanged it states the superseded order.
const TOPIC_MARKERS: ReadonlyArray<string> = [
	'**その追加コミットは、ゲートより先に push する**',
	'`pnpm josh followup --merge` の前に join する',
	'マージ条件（必須チェック全緑・ゲート緑・変更要求なし）は一切緩めない',
	SECTION_POINTER,
]

describe(`${PLAN_COMMENT} — the canonical topic agrees`, () => {
	const content = read_unwrapped(PLAN_COMMENT)

	it.each(TOPIC_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The command reference is where `josh git` run twice on one branch is documented, so it carries the
// mechanical consequence: the second run now precedes the gate, and a third supersedes a live cycle.
const COMMANDS_MARKERS: ReadonlyArray<string> = [
	'that commit goes out before its gate**',
	'`concurrency: cancel-in-progress: true` cancels rather than running to completion',
]

describe(`${COMMANDS_DOC} — the command reference carries the consequences`, () => {
	const content = read_unwrapped(COMMANDS_DOC)

	it.each(COMMANDS_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

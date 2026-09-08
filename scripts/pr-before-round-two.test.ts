import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1261: the pull request used to open after both review rounds, so the CI wait sat
// at the very end of a run with nothing beside it. Measured on joshuafolkken/kit#1251 — the second
// round ran 171 seconds, the CI that followed ran 98, and through those 98 seconds nothing else was
// happening.
//
// The correction moves `bump minor` / `gate` / `git -y` between the two rounds, so the verification
// pass runs beside CI. Each marker below pins one half of what makes that safe rather than merely
// faster, and dropping any one of them puts back a state the change exists to remove:
//
//   - without "only the second round moves", the first round drifts after the commit too, which is
//     the wider form joshuafolkken/kit#1216 rejected on a mechanism rather than a rule;
//   - without the nothing-edits-the-tree rule, something slips between the gate and the commit, the
//     gate record no longer matches the pushed tree and `review:brief --round 2` answers
//     `Not verified`, sending the review agent back to the unit suite the gate had just passed —
//     which costs more than the overlap saves (joshuafolkken/kit#1486 removed the version bump that
//     used to sit exactly there);
//   - without the follow-up-commit rule, a fix the second round makes in place never reaches CI;
//   - without the merge-gate sentence, the change reads as relaxing what `followup` blocks
//     on, which it does not.
const REVIEW_PROMPT = 'prompts/review.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const FULLRUN = '.claude/skills/workflow-commands/fullrun.md'
const QUEUE = '.claude/skills/workflow-commands/queue.md'
const HALFRUN = '.claude/skills/workflow-commands/halfrun.md'
const EVAL_GATE = '.claude/skills/workflow-commands/eval-gate.md'
const CLAUDE_DOC = 'CLAUDE.md'
const WORKFLOW_TOPIC = 'prompts/collaboration-workflow/plan-comment.md'
const BUNDLE_TOPIC = 'prompts/collaboration-workflow/epic-bundle.md'
const COMMANDS_DOC = 'docs/josh-commands.md'
const EVAL_DOC = 'docs/eval.md'

const CANONICAL_MARKERS: ReadonlyArray<string> = [
	'### The pull request opens between the rounds, so CI runs beside round 2',
	'**Only the second round moves, and that is what makes the overlap safe.**',
	'**Nothing edits the tree between that gate and the commit**',
	'**The merge gate is untouched.**',
	'**What this trades is a CI run for wall-clock, and the trade was made deliberately.**',
	// The narrowing is the whole argument against kit#1216's recorded rejection; without it the two
	// documents contradict each other and an agent picks whichever it read last.
	'the narrowing is what its objection asked for',
	'The round that changes code — the first — still runs before the commit.',
]

describe(`${REVIEW_PROMPT} — the single source states the new order`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(CANONICAL_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The claim the move makes false. It read as a reason the loop is cheap, so a surviving copy tells
// an agent the second round costs no CI run at the exact point it now can.
const RETIRED_ROUND_COST = 'Nothing is committed yet'
const RETIRED_ROUND_COST_FILES: ReadonlyArray<string> = [REVIEW_PROMPT, CHAIN_RULE]

describe('the pre-move cost claim is gone', () => {
	it.each(RETIRED_ROUND_COST_FILES)('%s no longer says it', (path) => {
		expect(read_unwrapped(path)).not.toContain(RETIRED_ROUND_COST)
	})
})

// Every file a run reads on its own has to carry the order itself: an entry following only its own
// procedure still has to open the pull request in the right place.
const BETWEEN_THE_ROUNDS = 'between the two review rounds'

const ENTRY_MARKERS: ReadonlyArray<readonly [string, string]> = [
	[SKILL, '**Where a second round is coming, the pull request opens between the two**'],
	[CHAIN_RULE, '**Open the pull request first**'],
	[FULLRUN, BETWEEN_THE_ROUNDS],
	// `queue` spells the whole per-issue pipeline in its own file rather than deferring to
	// `fullrun.md`, so an order stated only there leaves this entry running the old one.
	[QUEUE, '**The second review round runs between `pnpm josh git -y` and `pnpm josh followup`**'],
]

describe('every entry that opens a pull request states where it opens', () => {
	it.each(ENTRY_MARKERS)('%s states %j', (path, marker) => {
		expect(read_unwrapped(path)).toContain(marker)
	})
})

// The follow-up commit, asserted in each file that describes one. A fix the second round makes in
// place goes onto the branch that is already open — a second pull request is the mistake this half
// exists to name.
const FOLLOW_UP_COMMIT_FILES: ReadonlyArray<string> = [SKILL, CHAIN_RULE, FULLRUN, QUEUE]

describe('a second-round fix is a follow-up commit on the same branch', () => {
	it.each(FOLLOW_UP_COMMIT_FILES)('%s says so', (path) => {
		expect(read_unwrapped(path)).toContain('a follow-up commit on the same branch')
	})
})

// `halfrun` never commits, so nothing about a pull request between the rounds applies to it. Asserted
// as an absence because the wording is easy to copy across when the two files are edited together.
describe(`${HALFRUN} — the stop before commit is untouched`, () => {
	it('never claims a pull request opens between the rounds', () => {
		expect(read_unwrapped(HALFRUN)).not.toContain(BETWEEN_THE_ROUNDS)
	})
})

// The rule-compliance measurement re-anchored. Its verdict has always stopped the merge rather than
// the commit, and the commit is no longer the last step before the merge — so a document still
// naming `bump minor` would have the run read a verdict about a draft.
const EVAL_ANCHOR = 'before `pnpm josh followup`'
const EVAL_ANCHOR_FILES: ReadonlyArray<string> = [CLAUDE_DOC, EVAL_GATE, EVAL_DOC]

describe('the eval verdict is read before the merge, not before the bump', () => {
	it.each(EVAL_ANCHOR_FILES)('%s anchors it to the merge', (path) => {
		expect(read_unwrapped(path)).toContain(EVAL_ANCHOR)
	})

	it.each(EVAL_ANCHOR_FILES)('%s no longer anchors it to the bump', (path) => {
		expect(read_unwrapped(path)).not.toContain(
			'before `pnpm josh bump minor`, and never inside `pnpm josh gate`',
		)
	})
})

// The resident half. A standalone pre-commit self-review never opens a pull request, so the ordering
// itself is not resident — but the sentence that would forbid it is, and left unqualified it
// contradicts the skill on the turn a workflow is running.
describe(`${CLAUDE_DOC} — the resident self-review rule permits the split`, () => {
	const content = read_unwrapped(CLAUDE_DOC)

	it('scopes the resolve-before-commit rule to the round that precedes that commit', () => {
		expect(content).toContain(
			'**all high and medium findings of the round that precedes a commit**',
		)
	})

	it('keeps the merge as the thing no standing finding may pass', () => {
		expect(content).toContain('never merge on one still standing')
	})
})

// The canonical Japanese topic, which is what a reader following the workflow prompt reaches. It
// stated the opposite outright — that no per-round commit or CI re-run happens.
const TOPIC_MARKERS: ReadonlyArray<string> = [
	'**PR を開く位置は 2 周の間である**',
	'2 周目は そのコミットが起動した CI と並走させる',
]

describe(`${WORKFLOW_TOPIC} — the canonical topic agrees`, () => {
	const content = read_unwrapped(WORKFLOW_TOPIC)

	it.each(TOPIC_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('no longer denies that a round can cost a CI re-run', () => {
		expect(content).not.toContain('ラウンドごとのコミットや CI 再実行も発生しない')
	})
})

// The Japanese counterpart of `review.md`'s "not review during CI" paragraph. A non-Claude agent
// reads this one and never opens the skill, so leaving it saying the review stays wholly before the
// commit puts the two documents in direct contradiction.
describe(`${BUNDLE_TOPIC} — the Japanese carve-out matches the English one`, () => {
	const content = read_unwrapped(BUNDLE_TOPIC)

	it('names the second round as the one that runs beside CI', () => {
		expect(content).toContain('**2 周目だけは CI と並走する**')
	})

	it('no longer claims the whole review stays before the commit', () => {
		expect(content).not.toContain('レビュー自体はコミットの前のままで')
	})
})

// The command reference carries the two mechanical consequences: `josh git` run twice on one branch,
// and what the round-2 target therefore holds.
const COMMANDS_MARKERS: ReadonlyArray<string> = [
	'**Running it a second time on the same branch makes a follow-up commit, not a second pull request.**',
	"**`--round 2` is taken after the commit, and its target is round 1's fixes and nothing else.**",
]

describe(`${COMMANDS_DOC} — the command reference carries the consequences`, () => {
	const content = read_unwrapped(COMMANDS_DOC)

	it.each(COMMANDS_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

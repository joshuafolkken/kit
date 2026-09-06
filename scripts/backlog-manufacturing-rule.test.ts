import { describe, expect, it } from 'vitest'
import {
	AI_DOCS,
	read_index,
	read_repo_file,
	read_unwrapped,
	WORKFLOW_PROMPT,
} from './ai-document-fixture'

// joshuafolkken/kit#1469: over the seven days to 2026-09-06 the backlog took 257 filings against 163
// closures — +13.4 issues a day, with filings beating closures on all fourteen of the preceding
// fourteen days — while a `fullrun` ran a median of about ten minutes from pull request to merge.
// **Execution was never the bottleneck.** The workflow's own rules were the arrival side: the split
// assessment, the review round cap's residual findings, and the per-filing epic placement each
// produced issues at a rate proportional to how fast runs closed them.
//
// **The three defaults are pinned in one suite because they only work together.** The issue's own
// decision says so: a WIP cap arriving while the manufacturing routes are still open stops execution
// without stopping arrival, and a raised split threshold alone leaves the round cap filing. A suite
// per default would let one be reverted while the other two stayed green, which is exactly the state
// this change exists to leave.
//
// Every marker below is matched against `read_unwrapped`, so a hand-wrap moved by a formatter does
// not fail a test for a reason that has nothing to do with the rule.

const SPLIT_SKILL = '.claude/skills/workflow-commands/split-assessment.md'
const WORKFLOW_SKILL = '.claude/skills/workflow-commands/SKILL.md'
const REVIEW_PROMPT = 'prompts/review.md'
const WIP_TOPIC = 'prompts/collaboration-workflow/wip-cap.md'
// The guide, written once: the single source and the entry summary have to state the same numbers,
// and a guide that drifted between them would be two different thresholds under one rule.
const SPLIT_GUIDE = 'about 10 changed files and about 400 changed lines'

// Default 1 — the split assessment. The number is pinned as well as the default, because a default
// stated without a guide is read as "split when it feels large", which is the discretion the
// mechanical assessment exists to remove.
const SPLIT_MARKERS: ReadonlyArray<string> = [
	'**The default is not to split.**',
	'Two questions have to answer yes **together**',
	SPLIT_GUIDE,
	// The reason, without which the next reader restores the old test as an obvious simplification.
	'**Separability is not scarce, which is why a test made only of it splits nearly everything.**',
	'`route:split` accounted for **28 of the 119 open Issues (24%)**',
]

// Default 2 — the review round cap's three-way disposition. Branch 2's bar and branch 3's default
// are both pinned: the bar alone still reads as "file unless obviously droppable", and the default
// alone leaves "or it needs a decision" as a second live route into filing.
const REVIEW_MARKERS: ReadonlyArray<string> = [
	'**The default exit is branch 3, and branch 2 has to be earned**',
	'**confirmed defect that reaches a runtime code path** — both halves, and neither on its own',
	// The narrowing is in what *confirmed* means, never in what *reaching* means. Without this the
	// bar reads as excluding distributed documents, which would contradict the severity test and the
	// level rule in a repository whose product is its documents.
	'**Reaching is read exactly as test 1 of "Severity" above reads it**',
	'**"It needs a decision" is no longer a branch-2 condition on its own**',
	'**This is the default, and it takes everything the other two branches did not**',
	'**The note is not optional**',
	// The asymmetry that decides the trade, and the half a later reader mines for a reason to revert.
	'**What it costs, and why that is the right trade.**',
	'A filed finding that never mattered is carried forever',
]

// Default 3 — the WIP cap. The count is pinned as a command because a cap read from memory is not a
// cap; the two-sided procedure is pinned because a cap that stops a blocked run is the failure mode
// the issue names — manufacturing keeps going while execution stops. The split exemption is pinned
// with it, since withholding a split's children is how the cap would otherwise become a route to
// implementing N deliverables under one Issue's authorization.
const WIP_MARKERS: ReadonlyArray<string> = [
	'repos/{owner}/{repo}/issues?state=open&per_page=100',
	'select(.pull_request == null)',
	'オープン Issue が 30 件を超えている状態で新しく起票するときは、先に 1 件閉じる',
	'**判定するのは「起票 1 件」ではなく「起票のひとまとまり」である。**',
	'正直に閉じられるものが無いなら、起票しない',
	'場所を空けるために、まだ意味のある Issue を閉じてはならない',
	'実行が詰まる起票 — 上限が効かない側',
	'**分割の子がここに入る理由**',
	'上限を理由に止めない',
	'**上限は、増加を見えるようにするための強制装置である。**',
]

describe(`${SPLIT_SKILL} — the split default is raised, with its guide`, () => {
	const content = read_unwrapped(SPLIT_SKILL)

	it.each(SPLIT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${REVIEW_PROMPT} — the disposition default is branch 3`, () => {
	const content = read_unwrapped(REVIEW_PROMPT)

	it.each(REVIEW_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

describe(`${WIP_TOPIC} — the WIP cap and both sides of its procedure`, () => {
	const content = read_unwrapped(WIP_TOPIC)

	it.each(WIP_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The resident surface owes the trigger for each of the three and no more: a turn that never opens a
// pointer still has to raise the split bar, drop rather than file, and count before filing. The
// procedures stay at their pointers, which is what keeps `CLAUDE.md` under its budget — the count
// command included, so the one place it is written stays the one place it has to be kept correct.
const RESIDENT_MARKERS: ReadonlyArray<string> = [
	'**its default is not to split**',
	'about 10 changed files, about 400 changed lines',
	'file it as a follow-up Issue only when it is a confirmed defect that reaches a runtime path',
	// The heading sits above `### Shorthand Commands`, not inside it: that subtree is scoped to the
	// five keywords, and this rule's whole reason for being resident is that it fires on turns where
	// none of them was typed. The sentence is pinned so a later tidy-up cannot demote it back in.
	// **The heading level itself is asserted separately, on the raw text** — collapsed whitespace
	// cannot tell `###` from `####`, since the shorter string is a substring of the longer one.
	'**This binds on every filing, inside a workflow or not.**',
	'with more than 30 open, close one first',
	'Nothing honestly closable means **do not file**',
	'**A filing the run is blocked by is exempt**',
	WIP_TOPIC,
]

describe.each(AI_DOCS)('%s — carries the trigger for all three defaults', (document_path) => {
	const content = read_unwrapped(document_path)

	it.each(RESIDENT_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// Read raw, and with the surrounding newlines: demoted to `####` the section falls back inside
	// `### Shorthand Commands`, whose preamble scopes that subtree to the five keywords — and the
	// whole reason this rule is resident is that it fires on turns where none was typed.
	it('keeps the cap at heading level 3, outside the shorthand-command subtree', () => {
		expect(read_repo_file(document_path)).toContain('\n### Backlog WIP cap (30 open Issues)\n')
	})
})

// The index is how a topic file is reached at all: a file nothing links to is a file nobody opens.
// **`read_index` and not `read_repo_file`** — the fixture resolves the workflow prompt to the index
// concatenated with every topic file, so a deleted index row would still be found inside whichever
// topic happened to quote the label, and the assertion would pass on a link that no longer exists.
describe(`${WORKFLOW_PROMPT} — the WIP cap is reachable from the index`, () => {
	it('links the topic file', () => {
		expect(read_index()).toContain('| オープン Issue の WIP 上限（30 件）')
	})
})

// The entry summary is what a run reads before it opens the shared file. A default raised in the
// single source and left unraised here is the softening `split-assessment-document-rule.test.ts` was
// written to prevent, one document further out.
describe(`${WORKFLOW_SKILL} — the entry summary carries the raised default`, () => {
	const content = read_unwrapped(WORKFLOW_SKILL)

	it.each(['**The default is not to split**', SPLIT_GUIDE])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

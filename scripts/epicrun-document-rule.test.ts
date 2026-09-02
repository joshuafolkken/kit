import { describe, expect, it } from 'vitest'
import {
	AI_DOCS,
	read_index,
	read_repo_file,
	read_unwrapped,
	WORKFLOW_PROMPT,
} from './ai-document-fixture'
import { NEEDS_DECISION_LABEL } from './git/issue-labels'

// joshuafolkken/kit#861: `epicrun` is the keyword that lets a run finish without a person watching
// it, and the two rules that make that safe are the ones most easily lost in a reword — parking a
// child instead of stopping the session, and deciding waiting from the classification rather than
// from labels. A document that keeps the keyword but drops either one describes a run that either
// never finishes or stops in the moment it must wait.
//
// joshuafolkken/kit#1188 single-sources the procedure into the skill (the joshuafolkken/kit#1174
// pattern, rolled out under joshuafolkken/kit#1176). The whole of it used to be written twice —
// 307 lines of Japanese in the canonical topic file and the English procedure a run actually reads
// — and the canonical opened by *requiring* that duplication: "実行手順の正典は本節であり、運用手順
// は skill に置く。両者は一致していなければならない". That sentence is what made every rule below a
// rule to be written twice, and removing it is the change. The topic file is wholly this one topic,
// so it shrank in place rather than having a section extracted (joshuafolkken/kit#1186's route).

const SKILL = '.claude/skills/workflow-commands/epicrun.md'
const POINTER = 'prompts/collaboration-workflow/epicrun.md'
const QUEUE_SKILL = '.claude/skills/workflow-commands/queue.md'

// What each AI document has to say for itself. The rule surface concatenates every distributed
// skill, so a marker checked there passes on the skill's copy alone — which would not detect the
// paragraph being dropped from one document. These are read from the document itself.
//
// joshuafolkken/kit#951 moved the procedure into the skill: parking binds only once `epicrun` is
// running, so it fails the residency test and the documents carry the routing instead. The rule
// itself is asserted against the skill in `RULE_MARKERS` below.
const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'**`epicrun` parks a child instead of stopping the session**',
	'epicrun.md',
]

// Every timeout has a number, because "wait for a while" is how an unattended run hangs overnight.
// Pinned with their row text: a bare `60` appears throughout the file and would keep this green
// after the whole table was deleted.
const TIMEOUT_MARKERS: ReadonlyArray<string> = [
	'| Polling interval | 60 s |',
	'| Stale `in-progress` | 90 min |',
	'| Publish wait | 10 min |',
	'| Whole run | 8 h |',
]

// The guards, likewise.
const GUARD_MARKERS: ReadonlyArray<string> = [
	'| Children per run | 30 |',
	'| Issues filed per run | 10 |',
	'| Consecutive child failures | 3 |',
]

// The parts of the definition that are load-bearing. Every one of these used to be asserted twice —
// once against the English skill and once against the Japanese canonical — which is the duplication
// this Issue removes; they are now checked in the one file that holds them.
const RULE_MARKERS: ReadonlyArray<string> = [
	'park and continue',
	'one child per repository, repositories in parallel',
	'Stopping conditions',
	// The invariant is per *repository*, not per epic: the working tree, `main` and the
	// `package.json` `josh bump` rewrites are shared by every epic that touches the checkout, so an
	// `in-progress` issue this epic does not track still has to stop it (joshuafolkken/kit#925).
	'**The exclusion is per repository, and `epic:next` is what applies it.**',
	'whichever epic that issue belongs to',
	// The two limits are part of the definition: read as unconditional, an agent treats a `complete`
	// answer during an in-progress issue as impossible, and a parked child holds the repository it
	// was just set aside from.
	'a **parked** issue does not hold the repository',
	// Overstated as a mutex, a reader stops guarding the check-then-act window it does not close.
	'**It is advisory and it is not atomic.**',
	'**A listing it could not read is not an idle repository.**',
	// The label is only advisory, so the rule that removes an abandoned one has to reach past this
	// epic's own children — otherwise one stale label stalls every epic in the checkout, forever.
	"The rule therefore applies to any open issue in the repository, not only to this epic's children",
	// Without this the next epic inherits "concurrency needs no coordination" and ships a race.
	'has to **replace** this guard',
	'**Parking replaces stopping the session, not the rule that produced the stop.**',
	'**Removing the label is Tier A — do it without asking.**',
	// Reading the labels instead stops in the one moment the run must wait.
	"Waiting is decided by `epic:next`'s classification, never by reading labels",
	'a label-based reading calls that "done" and stops, in the one moment it must wait',
	// A Tier C action narrows the stop to one child rather than ending the run.
	'A Tier C action still stops — for that child.',
]

// joshuafolkken/kit#913: a child is run as `fullrun #<N>`, and `fullrun` requires `josh latest`
// before implementing — so following the loop literally runs the dependency update once per child.
// Each run rewrites `pnpm-lock.yaml`, which puts unrelated dependency bumps into every child's PR
// and parks children for CI failures they did not cause. `queue`, the same serial batch, already
// hoists it. These markers pin the hoist, and the one step that deliberately did NOT move with it.
const LATEST_HOIST_MARKERS: ReadonlyArray<string> = [
	// Session, not run: sessions are per repository, so "once per run" would leave a second
	// repository's children merging against stale dependencies with no `pnpm audit`.
	'`josh latest` runs once per session, not once per child',
	'**Session, not run**',
	'**`git switch main && git pull` stays per child.**',
	'A resumed `epicrun` is a new session',
	// The hoist does not make the first child's diff clean, and a reader who assumes it does will
	// look for a defect in the child when the bumps show up in its PR.
	'The lock file the update rewrites lands with the first child.',
	// Running it before the first `epic:next` strands a rewritten lock file on the default branch
	// whenever the first answer is not a child number — routine on a resumed run.
	'**Waiting until a child is in hand is what keeps the tree clean.**',
	// `josh latest` on a dirty tree is the case `queue` step 1 stashes for; without the same step
	// here, an unattended run either violates the stash prohibition or has no sanctioned path. The
	// sentence is pinned rather than the bare command, which `git stash pop` would satisfy alone.
	'The stash is the same sanctioned one `queue` step 1 uses',
	// The loop is where the per-child reading came from, so the exception has to be stated there
	// too — a reader following step 2 never reaches the section above it.
	'**except that `josh latest` is not run**',
	// The point of the change is that the two entry points to one serial batch stop disagreeing, so
	// the skill has to name the other. A hoist recorded on one side alone is how they drifted.
	'This is the same rule `queue.md` step 1 already states',
]

// joshuafolkken/kit#1139: the stale-`in-progress` paragraph counts the states that legitimately hold
// the label, and the sentence right after it is the whole instruction — a dirty tree means the hold
// is real, so leave the label alone. joshuafolkken/kit#1125 added a third state and left that
// sentence saying `Both`, which reads the `needs-human-review` stop straight out of the instruction.
// That state waits on a person reading an artifact, so it is the one most likely to outlast the
// 90-minute window and the one that must not be stripped. The count and the sentence move together.
const STALE_HOLDER_MARKERS: ReadonlyArray<string> = [
	'three ordinary states hold the label legitimately for longer than that',
	'a child stopped by `needs-human-review`',
	'**All three leave uncommitted work in the checkout**',
	'the `needs-human-review` stop by specification, since it commits nothing and stashes nothing',
]

// What the canonical document alone used to carry. `SKILL.md` → "Trimming is moving, never
// deleting.": each had to exist in the single source before the canonical text was cut, so they are
// pinned by name here rather than left to be noticed missing later. The list of them is on
// joshuafolkken/kit#1188 as a comment, written before any of the folding-in was done.
// Cited from both sides of the fold: the skill has to carry the reason the pickup consults the
// dependency graph, and the pointer has to name it as something that moved rather than something
// that was cut.
const PICKUP_DEPENDENCY_ISSUE = 'joshuafolkken/kit#996'

const FOLDED_IN_MARKERS: ReadonlyArray<string> = [
	// Why the keyword exists at all. The skill already said `queue` re-asks for authorization; what
	// only the canonical said is that a `queue` stop takes the *whole session* at a moment nothing
	// predicts, which is the reason parking one child is worth a keyword.
	'a decision needed mid-implementation stops the whole session',
	'the same guards, with the blast radius of a stop reduced from the session to one issue',
	// joshuafolkken/kit#996: without the dependency check the pickup starts a deliverable before the
	// thing it needs, and `auto-ok` says nothing about order.
	'An issue whose prerequisite is unresolved is never handed over',
	PICKUP_DEPENDENCY_ISSUE,
	// The deliberate difference between what the person was shown and what the pickup will take. A
	// reader without it reports the refusal as a defect in `auto-ok:next`.
	'The same ordering, though, is not the same set',
	// The waiting table's own last row. The pickup is defined in its own section, but a reader who
	// consults only the table would finish the run without it.
	'| No open child | Post the epic summary, pick up the `auto-ok` issues ("After the epic" above), then finish |',
	// Who untangles a cyclic graph. The stopping conditions list `error`; only the canonical said
	// that ending the wait and reporting is the whole of `epicrun`'s part in it.
	"A graph that has deadlocked on a cycle is not this loop's to untangle",
]

describe('epicrun definition', () => {
	it.each(AI_DOCS)('is routed to from %s, by name and by file', (document_name) => {
		const content = read_unwrapped(document_name)

		for (const marker of AI_DOC_MARKERS) expect(content).toContain(marker)
	})

	it.each(AI_DOCS)('lists the keyword in the shorthand table of %s', (document_name) => {
		expect(read_unwrapped(document_name)).toContain('| `epicrun #E`')
	})

	// The upstream-interrupt rule is where a reader looks when a defect appears mid-run, and it has
	// to say that the stop is now scoped to one child rather than the session. It lives in a topic
	// file that still carries its own body, so it is still asserted against the canonical corpus.
	it('records the narrowed stop in the upstream-interrupt rule', () => {
		expect(read_unwrapped(WORKFLOW_PROMPT)).toContain(
			'`epicrun` の中では、停止の範囲がセッション全体ではなくその子 Issue に限定される',
		)
	})
})

describe(`${SKILL} — the single source states the rule`, () => {
	const content = read_unwrapped(SKILL)

	it.each([...RULE_MARKERS, ...LATEST_HOIST_MARKERS, ...STALE_HOLDER_MARKERS])(
		'states %j',
		(marker) => {
			expect(content).toContain(marker)
		},
	)

	it.each([...TIMEOUT_MARKERS, ...GUARD_MARKERS])('pins a number on %j', (marker) => {
		expect(read_repo_file(SKILL)).toContain(marker)
	})

	it('names the label the park uses', () => {
		expect(read_repo_file(SKILL)).toContain(NEEDS_DECISION_LABEL)
	})

	// `queue` is the side that was already correct; if its own hoist is reworded away, `epicrun`
	// points at a rule that no longer exists.
	it('keeps the queue rule the skill defers to', () => {
		expect(read_unwrapped(QUEUE_SKILL)).toContain(
			'`josh latest` runs only once, before the first issue',
		)
	})
})

describe(`${SKILL} — carries what only the canonical document had`, () => {
	const content = read_unwrapped(SKILL)

	it.each(FOLDED_IN_MARKERS)('folded in %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// One marker per part of the body the canonical used to carry, one from each of five sections. The
// generic size check compares this pointer against the whole skill, so a single section creeping
// back would stay under it.
//
// **Every marker has to survive `read_unwrapped`'s whitespace collapse.** The waiting table's row
// was written `| ポーリング間隔              | 60 秒` — column padding the collapse turns into single
// spaces, so `not.toContain` could never fail and the whole Japanese table could be pasted back with
// this suite still green. The row is pinned by its cell text instead, which is the part a restored
// body would actually carry.
//
// The last three are the sections the pointer *summarizes*, and they are where a restatement is most
// likely to creep back. Without them the check would be green by choice of sample — the first five
// name sections the pointer does not mention at all — rather than because the body stayed out.
const POINTER_MUST_NOT_RESTATE: ReadonlyArray<string> = [
	'排他はリポジトリ単位であり、それを適用するのは `epic:next` である',
	'これは advisory であり、アトミックではない',
	'**書き換えられた lock ファイルは最初の子と一緒に入る。**',
	'**2 件目以降で `--exclude` を省略してはならない。**',
	'子 1 件の `fullrun` は分単位。これより短くしても API 消費が増えるだけ',
	'`queue` との違いはひとつだけである',
	'閉じていない blocker を宣言している候補を除外する',
	'これは意図した差である',
]

// The pointer half. The generic size and citation rules are asserted for every converted topic by
// `pointer-citation-document-rule.test.ts`; what is specific here is that the body did not stay
// behind, and that the declaration this Issue was filed to delete is gone.
describe('the canonical topic file is a pointer to the skill single source', () => {
	const pointer = read_unwrapped(POINTER)

	it.each([SKILL, 'クローン禁止・単一ソース化'])(
		'names the skill as the single source: %j',
		(marker) => {
			expect(pointer).toContain(marker)
		},
	)

	// The sentence the Issue exists to remove. It is what required the duplication rather than
	// merely describing it, so a conversion that left it standing would have changed nothing.
	it('no longer requires the two documents to agree', () => {
		expect(pointer).not.toContain('両者は一致していなければならない')
		expect(pointer).not.toContain('実行手順の正典は本節であり')
	})

	it.each(POINTER_MUST_NOT_RESTATE)('does not duplicate the rule body: %j', (marker) => {
		expect(pointer).not.toContain(marker)
	})

	// Naming what the canonical alone had is what makes the fold-in auditable from the pointer side:
	// a reader who wonders whether something was lost reads the list here and finds it in the skill.
	it.each(['`queue` との違い', PICKUP_DEPENDENCY_ISSUE, '循環依存の担当分け'])(
		'records what was folded in: %j',
		(marker) => {
			expect(pointer).toContain(marker)
		},
	)

	// A back-reference from the single source itself costs no second hop, and it is what tells a
	// reader who landed on the skill that the topic file holds no body.
	it('is named as a pointer by the skill that now holds the body', () => {
		expect(read_unwrapped(SKILL)).toContain(`\`${POINTER}\` is a pointer to it`)
	})

	// The index is the only route to a pointer, so a topic file it does not list is unreachable.
	it('is listed in the index', () => {
		expect(read_index()).toContain('(./collaboration-workflow/epicrun.md)')
	})
})

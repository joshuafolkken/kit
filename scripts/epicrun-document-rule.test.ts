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
	'as many children per repository as it has free lanes',
	'Stopping conditions',
	// The count is per *repository*, not per epic (joshuafolkken/kit#925): an `in-progress` issue
	// this epic does not track still occupies one of that repository's lanes, and a session counting
	// only its own epic's children would run past the limit (joshuafolkken/kit#1491).
	'**The lane count is per repository, and `epic:next` is what applies it.**',
	'whichever epic that issue belongs to',
	// The two limits are part of the definition: read as unconditional, an agent treats a `complete`
	// answer during an in-progress issue as impossible, and a parked child goes on holding the lane
	// it was just set aside from.
	'not hold a lane: `needs-decision` outranks `in-progress`',
	// Overstated as a mutex, a reader stops guarding the check-then-act window it does not close.
	'**It is advisory and it is not atomic.**',
	'**A listing it could not read is not an idle repository.**',
	// The label is only advisory, so the rule that removes an abandoned one has to reach past this
	// epic's own children — otherwise one stale label stalls every epic in the checkout, forever.
	"The rule therefore applies to any open issue in the repository, not only to this epic's children",
	// Without this the next epic inherits "concurrency needs no coordination" and ships a race.
	'Do not read any of this as "concurrency needs no coordination"',
	'**Parking replaces stopping the session, not the rule that produced the stop.**',
	'**Removing the label is Tier A — do it without asking.**',
	// Reading the labels instead stops in the one moment the run must wait.
	"Waiting is decided by `epic:next`'s classification, never by reading labels",
	'a label-based reading calls that "done" and stops, in the one moment it must wait',
	// A Tier C action narrows the stop to one child rather than ending the run.
	'A Tier C action still stops — for that child.',
]

// joshuafolkken/kit#1492: the procedure that drives the lanes joshuafolkken/kit#1490 opens and
// joshuafolkken/kit#1491 counts. Each marker below is a step or a decision that cannot be re-derived
// from the commands: the commands say what a lane *is*, and these say what a run does with one.
const LANE_MARKERS: ReadonlyArray<string> = [
	'Lanes — running more than one child at a time',
	// Six lanes make overlap real, and every overlap that conflicts parks a child. Reported as a
	// throughput win alone, the run reads as more unattended when it is measurably less.
	'**Running unattended gets harder, not easier, and that is the honest trade.**',
	// A lane's `latest:scope` is keyed to its own project root, so it has no stamp and always answers
	// `required` — six lanes, six dependency updates, which is the hoist's own failure one layer down.
	'**`pnpm josh latest` is never run inside a lane, whatever `latest:scope` answers there.**',
	// With no child in the primary checkout, the rewritten lock file has nothing to commit it.
	'The rewritten lock file still has to reach a pull request',
	// joshuafolkken/kit#1554: `lane:open` now installs, so what has to be pinned is no longer "do not
	// skip the install" but which line owns it — a runner that still reads the third line as *the*
	// install would take a lane that already works for one that needs finishing.
	'**`lane:open` installs; the third line is a *re*-install, and only the popping lane needs it**',
	// joshuafolkken/kit#1497: `pnpm josh git` compares on the `<N>-` prefix, so the lane branch leads
	// with the issue number — and the obvious way round the old `lane/<N>` is still the trap. The
	// registry identifies a lane *by* that branch (`lane-registry.ts` → `branch_issue`), so switching
	// drops the lane out of `list_lanes()`: the next `lane:open` re-issues its seat and two live
	// lanes bind one pair of ports. The name and the prohibition are pinned separately because a
	// document keeping only the name reads as an invitation to rename it again locally.
	"**A lane's branch is `<N>-lane`, and the issue number leads it",
	'**Switching the lane to another branch is not the way round it',
	"**Nothing switches the lane's branch.**",
	'joshuafolkken/kit#1497',
	// The whole point of the rename is that the loop asks for lanes. A snippet without `--lanes` is
	// the one that gets copied, and a run copying it does one child at a time for no reason.
	'--repo joshuafolkken/kit --lanes',
	'**`--lanes` is the form to use.**',
	// The pop carries the lock file the gate has to build against; left at what `lane:open` installed,
	// the first child's gate runs against `node_modules` from the previous lock while committing the
	// new one — which is why that one lane installs twice rather than once.
	'**What the pop changes is the lock, which is why that one lane installs twice.**',
	// Every lane's HEAD is off the default branch, so `run:preflight` answers `reclaim` on all of
	// them and prints a recovery a linked work tree cannot run.
	"**`pnpm josh run:preflight` is not asked in a lane; `lane:open`'s own answer replaces it.**",
	// The whole conflict design in one sentence: no forecast, and the merge is where it shows.
	'**Nothing here forecasts which children will overlap.**',
	'comes back `mergeStateStatus: DIRTY`',
	// A lost merge race is what six lanes produce on purpose; counted as a failure it aborts the run
	// for working as designed.
	'It is **not** counted against the consecutive-failure guard',
	// joshuafolkken/kit#1623: the child resolves the conflict rather than being parked. The premise
	// that makes it safe to try is pinned beside the instruction — an agent that reads the steps
	// without reading why the work survives them will reach for a park at the first refusal.
	'**That child does not stop: it resolves the conflict in its own lane**',
	'**Nothing is at risk while it resolves, because the work is already committed and pushed.**',
	// The direction is load-bearing: a rebase rewrites pushed commits and needs a force push, which
	// this package denies outright, so a document that says only "take main" describes a dead end.
	"**The merge direction is `origin/main` into the lane's branch, never a rebase**",
	// The rule's whole point. Written as "a person decides" it reads as a safety measure, which is
	// the reasoning joshuafolkken/kit#1623 found misdirected: the danger is unreviewed code merging,
	// and that is answered by re-running the verification, not by changing whose hand resolves.
	'**The safeguard is the re-run verification, not who holds the pen.**',
	'**In this repository routing it to a person does not even resolve it**',
	// The four exits, pinned individually. A list pinned only by its heading can lose a row silently,
	// and each row here is what keeps the decision off the agent's judgement at a cost-pressured
	// moment — which is exactly when a missing row gets filled in with "it seemed fine".
	'**The run steps back under these four conditions, and under no others. The list is exhaustive and carries no judgement.**',
	"**The resolution requires deleting the other side's change.**",
	'**Both sides rewrote the same lines**',
	'**A second conflict on the same child.**',
	// The bound condition 3 asserts is only real if something durable records the resolution. A merge
	// commit on a lane branch is not that: a session resuming after an interrupt cannot count them.
	'never off memory, so it survives an interrupt',
	// Condition 4 has to cover an ordinary red gate, not only a High. A merged `main` can introduce a
	// lint error or a failing test, and a list declared exhaustive that has no exit for the most
	// likely outcome of step 2 sends the agent back to judgement at the moment it must not.
	'**The re-run gate did not come back green, or the resolution review returned a High.**',
	// The one step-back that is not a code decision has to say what shape it takes, or it becomes a
	// diff mailed to somebody who does not read diffs.
	'"behavior A or behavior B" — never as a diff',
	// The lane row for a conflict, and the exception joshuafolkken/kit#1623 removed from the table.
	'| The child hit a **merge conflict** |',
	'**Every after-commit park now keeps its lane, with no exception left in this table**',
	'**A lost merge race is not one of these rows**',
	// What a lane does on each ending — the four the Issue asked to have written down.
	'What happens to a lane',
	'**Its lane is left open and untouched**',
	"The next session's `pnpm josh lane:prune` closes what git no longer has a tree for",
	// joshuafolkken/kit#1587: a park was one row, written for a child whose work is uncommitted. A
	// child parked *after* its commit and push inverts every step of it — the stash is a no-op, and
	// the close deletes the local branch the resume reads — so the two states are pinned separately.
	// Pinning only the phrase "parked" would let either row satisfy the assertion.
	'The child was **parked before its commit**',
	'The child was **parked after its commit and push**',
	// The reasons have to stay beside the rows: without them the kept lane reads as an exemption
	// somebody granted, and the next run closes it back.
	"**A committed child's lane is kept because closing it deletes the branch its resume needs, and no command puts that branch back**",
	'`git branch -D <N>-lane`',
	'so it would cut a **fresh, empty** branch of that',
	// Which row a child takes, and what decides it. Left to judgement it contradicts "Conflicts are
	// not predicted", which now sends a lost merge race to a resolution in the lane it is already in.
	// joshuafolkken/kit#1623 reworded this from "the exception" — the exception it named was the one
	// arm that still closed, and that arm is gone, so the old sentence announced a carve-out its own
	// paragraph had just abolished.
	'**Which of these rows a child takes is decided by what `followup` printed, not by reading the situation.**',
	// The conflict row and the failure row both match one `followup` outcome, so the table has to say
	// which wins. Without it the failed row's consecutive-failure count is charged to a lost merge
	// race, which is the abort the prose two sections up explicitly forbids.
	'**A merge conflict is not this row**',
	// A park read before step 4 leaves an unconcluded merge in a lane that is kept, and the row it
	// takes justifies itself on the tree being clean. The abort is what makes those two agree, and it
	// has to name which conditions it covers — scoped to 1 and 2 it left condition 4 holding a
	// resolved-but-uncommitted merge, which is the same hazard from the other side.
	'**Leave the tree clean before parking: `git merge --abort` precedes a park under conditions 1, 2 or 4.**',
	// Without a step that concludes and pushes the merge, `origin` never changes: step 5 reads the
	// same conflict, condition 3 counts it as the second, and the child is parked for good. The
	// procedure could not reach a merge at all. The deny is pinned with it because an agent that
	// reaches for `git commit` by hand is refused and has nowhere documented to go.
	'**Conclude the merge and push it, with `pnpm josh git -y`.**',
	'denies `Bash(git commit*)` and `Bash(git add*)`',
	// The recording moved from step 1 to step 4 so that an attempt ending in a park leaves no count
	// behind — recorded at step 1, an aborted merge still spent the child's one resolution.
	'Recording it *here* rather than at step 1',
	'The count is read off the Issue comments step 4 writes',
	// The seat is the reason the old row closed unconditionally, so keeping a lane has to answer it
	// rather than ignore it.
	'**A kept lane holds its seat, and that is the price rather than an oversight.**',
	// `followup` releases the hold at the merge, and a parked child never reaches one.
	'**Release the hold on either parked arm, and leave the lane before closing it.**',
	// joshuafolkken/kit#1587 round 2: a `needs-human-review` stop keeps its hold, so a release stated
	// for "every ending" would send the next run over the uncommitted tree a person has to look at.
	'**A `needs-human-review` stop is not a park and keeps its hold**',
	// `followup` prints the normalized `mergeStateStatus`, never the REST `mergeable_state`. Pinned on
	// the warning rather than the spelling, which the conflict section above already contains — an
	// agent told to decide from output that never appears falls back to judgement.
	'Do not grep the output for `mergeable_state`',
	// The paragraph has to lead with the string that actually reaches the operator. Leading with the
	// internal comparison spelling sends an agent searching for output that is never written, which
	// is the same fallback-to-judgement the paragraph exists to remove.
	'**What it prints is `PR checks failed (merge conflict)`**',
	// The Issue's acceptance criterion is that the CI-concurrency question is answered either way and
	// which way is recorded. Dropping this leaves the criterion satisfied by silence.
	'CI concurrency — recorded as to-be-measured',
	'**This is recorded as to-be-measured rather than addressed, and the reasons are these.**',
	// The measurement is half-done by construction, and the missing half has to stay visible rather
	// than being quietly dropped once the document reads as finished.
	'**Baseline, measured on 2026-09-06 before any lane existed**',
	'**The "after" is not in this document, and saying so is the point.**',
]

// The premises this section asserted before lanes existed. Each was answered rather than waived, and
// a document that still carries the old sentence tells the next reader that same-repository
// parallelism is out of scope — which is what the procedure above now is.
const WITHDRAWN_PREMISES: ReadonlyArray<string> = [
	'has to **replace** this guard',
	'Two children of one repository still may not run at once',
	'Why same-repository parallelism is out of scope here',
	// joshuafolkken/kit#1497 renamed the lane branch, so the freeze these sentences imposed is over.
	// Left in place they tell a reader to drop back to one child at a time — the lane machinery three
	// issues built, switched off by a paragraph nobody remembered to delete.
	'**The lane path is not executable yet, and one command is why.**',
	'Until it lands, ask `epic:next`',
	'**The snippet shows the one-at-a-time form deliberately.**',
	'add --lanes once joshuafolkken/kit#1497 lands',
	// joshuafolkken/kit#1623 withdrew the refusal to resolve. These are pinned absent rather than
	// merely unpinned because the failure mode is a half-edit: an agent that adds the resolution
	// procedure and leaves the old refusal standing ships a document that both instructs and forbids
	// the same act, and the positive markers above would all still pass.
	'**Rebasing the loser automatically is deliberately not done.**',
	'A person re-runs the child on a current',
	'its lane closed rather than kept',
	// The table's removed exception. Left behind, it closes the very lane the resolution runs in.
	'the park was a lost merge race, which is closed instead',
	// The sentence that framed that exception. It survived the first edit of joshuafolkken/kit#1623
	// and announced a carve-out the three sentences after it had just withdrawn — a reader going
	// top-down still reached for `lane:close`.
	'**The exception is decided by what `followup` printed, not by reading the situation.**',
	// The unattended-trade paragraph is three sections above the conflict rule and was written when a
	// conflict parked. Left standing it tells a reader arriving top-down that every overlap waits for
	// a person, which is the opposite of what that rule now says.
	'parks a child, which waits for a person',
	'asks for a person more often',
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
		expect(read_unwrapped(document_name)).toContain('| `epicrun #E…`')
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

	it.each([...RULE_MARKERS, ...LATEST_HOIST_MARKERS, ...STALE_HOLDER_MARKERS, ...LANE_MARKERS])(
		'states %j',
		(marker) => {
			expect(content).toContain(marker)
		},
	)

	it.each(WITHDRAWN_PREMISES)('no longer asserts the replaced premise: %j', (marker) => {
		expect(content).not.toContain(marker)
	})

	// The table is what makes the replacement auditable rather than merely absent: a reader who
	// remembers one of the three premises finds which of them was solved and which was declined.
	it('records what replaced each premise it withdrew', () => {
		expect(read_repo_file(SKILL)).toContain('| The premise this section used to assert')
		expect(read_repo_file(SKILL)).toContain('**Not built, deliberately.**')
	})

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

	// joshuafolkken/kit#1147: naming only "the parent reads GitHub state" leaves the return
	// classification invisible from this side, and the branch that matters most is the one a reader
	// re-derives wrongly — an open child stopped on purpose looks exactly like one that failed.
	it('names the return classification and its branches', () => {
		expect(pointer).toContain('4 分岐')
		expect(pointer).toContain('`human_review: yes`')
	})

	// The index is the only route to a pointer, so a topic file it does not list is unreachable.
	it('is listed in the index', () => {
		expect(read_index()).toContain('(./collaboration-workflow/epicrun.md)')
	})
})

import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'
import { INTERRUPT_ROUTE_LABEL, TIER_A_ROUTE_LABEL } from './git/issue-labels'

// joshuafolkken/kit#1649: the rules named three things a run can discover mid-run — an upstream
// defect, a split, a prerequisite — and each of the three ends in a written procedure. A plain
// observation belongs to none of them: it changes nothing about the Issue in hand, so no route
// covered it, and a run reaching one fell back on the most cautious-looking thing available and
// asked a person whether to file. That is wrong on the merits (a first-party filing is Tier A and
// reversible, which `CLAUDE.md` already settles) and wrong for the batch entry points, which run on
// nobody watching — a run that stops for an answer has parked itself without saying so.
//
// These markers pin the parts a reword most easily loses: that the filing needs no confirmation,
// that the two ceilings still bite, and that the run does not stop. The `route:` label distinction
// is pinned through the exported constants rather than by literal, so renaming a label breaks the
// document assertion instead of leaving the prose quietly naming a label that no longer exists.
//
// The second half is the mirror image — a report that should not be made. `epicrun.md`'s stale-label
// rule is about an *open* issue, because an open one holds a lane; a closed issue holds none and
// `epic:next` never offers it, so its labels are inert. Reported anyway, they are non-findings
// occupying the place a real finding would be read in.

const WORKFLOW_SKILL = '.claude/skills/workflow-commands/SKILL.md'
const EPICRUN_SKILL = '.claude/skills/workflow-commands/epicrun.md'

// Read the documents themselves rather than the concatenated rule surface: the surface joins every
// distributed skill, so a marker checked there would pass on some other file's copy — which is the
// drift these suites exist to catch.
const skill_text = read_unwrapped(WORKFLOW_SKILL)
const epicrun_text = read_unwrapped(EPICRUN_SKILL)

// The route has to be reachable from where the other three are enumerated. A section nothing points
// at is a section a run never opens, which is indistinguishable from not having written it.
const ROUTING_MARKERS: ReadonlyArray<string> = [
	'**Four kinds of other work turn up mid-run, and the procedure differs for each.**',
	'Something worth filing that is **none of the three** (**an observation**)',
	'**An observation worth filing is filed without asking, and the run carries on** — §2i',
	'## 2i. An observation worth filing is filed without asking',
	// joshuafolkken/kit#1698: both places that route here have to carry the two limits as well.
	// A run reaching the table row or the §2 bullet has already been told what to do, and never opens
	// §2i — which is how a child would go on filing after the section below forbade it.
	'**A delegated child does not file here**, and a filing at depth 1 or deeper cites the depth-0 work it blocked',
	'**a delegated child does not take this route at all**',
]

// The rule itself. "Without asking" is the whole point, so it is pinned in the section's own words
// and again as the tier that authorizes it.
const NO_CONFIRMATION_MARKERS: ReadonlyArray<string> = [
	'**A run that judges something worth filing files it, and does not ask.**',
	'Filing into a first-party repository is **Tier A**',
	'File it, without asking, the moment you judge it worth filing',
	// The first-party test is mechanical at every other decision point in these documents, and an
	// observation filed into someone else's tracker is the one mistake that cannot be taken back.
	'`gh api repos/{owner}/{repo} --jq .owner.login` rather than by judgement',
	'**A third-party target is Tier C and is never filed**',
]

// Removing the confirmation removes the only thing that used to stop a chain of false positives, so
// the two ceilings are what remain. A route that escaped either would be the failure the ceilings
// were written for, arriving under a new name.
const CEILING_MARKERS: ReadonlyArray<string> = [
	'**Both ceilings apply to this route exactly as they do to the other three.**',
	'**10 Issues per run** counts this filing too',
	'So does the backlog **WIP cap**',
	'an observation that does not block the run is *discretionary*',
	'more than 30 open Issues in the target repository, close one first',
	'nothing honestly closable means do not file',
	'`prompts/collaboration-workflow/wip-cap.md`',
]

// Built from the exported constants so a label rename fails here rather than leaving the prose
// naming one that no longer exists.
const LABEL_MARKERS: ReadonlyArray<string> = [
	'**It carries no `route:` label of its own.**',
	`\`${TIER_A_ROUTE_LABEL}\` means a filing the run is *blocked by*`,
	`takes \`${INTERRUPT_ROUTE_LABEL}\``,
]

// What separates this route from the other three: they all change what the run does next, and this
// one does not. Without these the section reads as a fourth way to stop.
const CONTINUATION_MARKERS: ReadonlyArray<string> = [
	'**The run continues.** Nothing is stashed, nothing is parked, no Telegram is sent',
	'Name what was filed in the completion report.',
	// A filing no epic tracks is one `epic:next` never offers — filed and parked forever, which is
	// the outcome the whole route exists to avoid.
	'**Run `pnpm josh epic:bundle <new>` on what was filed**',
	// The judgement that is deliberately kept, so "file without asking" is not read as "file
	// everything".
	'**What stays a judgement is whether it is worth filing, not whether to ask.**',
]

// joshuafolkken/kit#1698: removing the confirmation left one judgement behind — "is it worth
// filing" — and an agent an hour deep in the workflow tooling answers yes to almost anything about
// the workflow tooling. The 2026-09-09 `backlogrun` shipped 5 and filed 15 without one change a
// consumer would see. These markers pin the two things that take that judgement back out: the depth
// table, which is read off the subject so it cannot be argued with, and the citation it demands.
const DEPTH_TEST_MARKERS: ReadonlyArray<string> = [
	'### The depth test — a discretionary filing cites the product work it blocked',
	'**A listing that measures itself has no natural stopping condition**',
	'**depth is what supplies it — read off the subject rather than judged**',
	'| **0** | What a consumer of this package touches |',
	'| **1** | The run orchestration that executes an Issue |',
	'| **2** | What measures a run |',
	'it stopped or delayed** — named as an Issue number or a run',
	'**Cannot cite one, it is not filed**',
]

// The exclusions are the half a reword loses first, because they read as omissions rather than as
// decisions. Without them the test bites on the product it exists to protect, and on the two routes
// that file precisely because the run cannot continue.
const DEPTH_EXCLUSION_MARKERS: ReadonlyArray<string> = [
	'**A depth-0 observation does not take this test.**',
	`\`${TIER_A_ROUTE_LABEL}\` and \`${INTERRUPT_ROUTE_LABEL}\` do not take it either`,
	'already citing its own blockage',
	// The boundary against `prompts/review.md`'s branch 2. Without it the depth test reads as
	// governing every filing route, and a confirmed defect in a `josh` command — depth 0, and the one
	// finding both documents agree is never dropped — could be gated on a citation it cannot make.
	"**It governs this route only — the fourth row of §2d's table.**",
	'**does not take the depth test**',
	// The rejected alternative, kept so the next reader proposes something else rather than
	// re-deriving a cap whose overflow disappears silently.
	'**This is not the count cap that was rejected.**',
]

// The second mechanism. A child that files on its own defeats both ceilings at once: it cannot see
// a sibling's filing, and the per-run count it would be measured against is the parent's.
const DELEGATED_CHILD_MARKERS: ReadonlyArray<string> = [
	'### A delegated child does not take this route',
	`**A delegated child files \`${TIER_A_ROUTE_LABEL}\` and \`${INTERRUPT_ROUTE_LABEL}\` only.**`,
	'**it cannot tell its observation from the one a sibling filed twenty minutes earlier**',
	"**the 10-per-run ceiling for this route is the parent's to count**",
	'which is why it did not fire once on the run that filed fifteen',
]

// `epicrun.md` holds the return path itself, so it has to say that the path is the only one — a
// child reading the summary list alone would find no reason not to file as well.
const CHILD_RETURN_MARKERS: ReadonlyArray<string> = [
	"**This is the only route a child's discretionary observation has**",
	'`SKILL.md` → §2i, the single source',
]

// The single-source declaration. Without it the next rollout adds a topic file under
// `prompts/collaboration-workflow/` and the two copies drift.
const SINGLE_SOURCE_MARKER =
	'This section is the single source of the rule; nothing under `prompts/collaboration-workflow/` restates it (joshuafolkken/kit#1649).'

// The mirror-image half, in `epicrun.md`'s stale-label section.
const CLOSED_ISSUE_MARKERS: ReadonlyArray<string> = [
	"**A closed issue's labels are neither a finding nor something to clean up.**",
	'a closed issue holds no lane',
	'`epic:next` never offers it',
	'**Do not report it, and do not strip it**',
	// Why it is not merely harmless: a non-finding reported is a real finding made harder to see.
	'a run that lists non-findings is a run whose real findings are harder to see',
]

describe(`${WORKFLOW_SKILL} — the fourth route is reachable from the other three`, () => {
	// Named per marker rather than looped inside one case: a failure has to say which marker went
	// missing, not only that the first one did.
	it.each(ROUTING_MARKERS)('routes to the observation section: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})
})

describe(`${WORKFLOW_SKILL} — filing an observation needs no confirmation`, () => {
	it.each(NO_CONFIRMATION_MARKERS)('states the Tier A filing: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})

	it.each(LABEL_MARKERS)('separates the route labels: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})
})

describe(`${WORKFLOW_SKILL} — the ceilings that replace the confirmation`, () => {
	it.each(CEILING_MARKERS)('keeps both caps on this route: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})
})

describe(`${WORKFLOW_SKILL} — a discretionary filing cites the product work it blocked`, () => {
	it.each(DEPTH_TEST_MARKERS)('states the depth test: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})

	it.each(DEPTH_EXCLUSION_MARKERS)('keeps the exclusions explicit: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})
})

describe(`${WORKFLOW_SKILL} — a delegated child returns the observation instead`, () => {
	it.each(DELEGATED_CHILD_MARKERS)('withholds the route from a child: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})
})

describe(`${WORKFLOW_SKILL} — the run is not stopped by an observation`, () => {
	it.each(CONTINUATION_MARKERS)('states that the run carries on: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})

	it('declares itself the single source', () => {
		expect(skill_text).toContain(SINGLE_SOURCE_MARKER)
	})
})

describe(`${EPICRUN_SKILL} — a closed issue's labels are not a finding`, () => {
	it.each(CLOSED_ISSUE_MARKERS)('states the closed-issue carve-out: %j', (marker) => {
		expect(epicrun_text).toContain(marker)
	})

	// The child's return path, pinned where it is written rather than only where it is ruled on: a
	// summary list that does not say it is the only route reads as one option among two.
	it.each(CHILD_RETURN_MARKERS)('names the summary as the only route: %j', (marker) => {
		expect(epicrun_text).toContain(marker)
	})

	// The new paragraph leans on the existing sentence rather than contradicting it: the stale-label
	// rule was always about open issues, and this says what the other half of that means.
	it('leaves the open-issue rule it qualifies in place', () => {
		expect(epicrun_text).toContain(
			"The rule therefore applies to any open issue in the repository, not only to this epic's children",
		)
	})
})

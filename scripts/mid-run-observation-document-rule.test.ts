import { describe, expect, it } from 'vitest'
import { read_repo_file, read_unwrapped } from './ai-document-fixture'
import { INTERRUPT_ROUTE_LABEL, TIER_A_ROUTE_LABEL } from './git/issue-labels'
import { COMMAND_MAP } from './josh/josh-command-map'

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
const OBSERVATION_LEDGER = 'docs/observations.md'
const JOSH_COMMANDS_DOC = 'docs/josh-commands.md'
// Written once and asserted against `COMMAND_MAP` below as well as against the prose, so a rename
// that reaches only one of the two fails here instead of leaving a document naming a command the CLI
// does not have.
const LEDGER_FLUSH_COMMAND = 'observations:flush'

// Read the documents themselves rather than the concatenated rule surface: the surface joins every
// distributed skill, so a marker checked there would pass on some other file's copy — which is the
// drift these suites exist to catch.
const skill_text = read_unwrapped(WORKFLOW_SKILL)
const epicrun_text = read_unwrapped(EPICRUN_SKILL)
const ledger_unwrapped = read_unwrapped(OBSERVATION_LEDGER)
// The ledger's line grammar is the one thing here that whitespace carries meaning in, so it is read
// raw. `read_unwrapped` collapses every newline, which would merge the entries into one string and
// make a per-line grammar assertion impossible to write.
const ledger_raw = read_repo_file(OBSERVATION_LEDGER)

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

// joshuafolkken/kit#1728: an observation that could not cite a blockage went to the completion
// report, which is read once and then scrolls away — so "not filed" meant "gone", every later
// sighting looked like the first, and the gate was walked past rather than held (#1726 says so in its
// own body). The ledger is the third destination. These markers pin the parts a reword loses first:
// that it is append-only, that the repeat test is a key rather than a similarity judgement, and that
// the second sighting is what files it.
const LEDGER_MARKERS: ReadonlyArray<string> = [
	'### The ledger — where an observation that cannot cite a blockage goes',
	// The changed default itself. Left as "the completion report", the section below has nothing to
	// route to and the whole mechanism is inert.
	'**Cannot cite one, it is not filed**: it goes to the ledger below',
	`**The destination is \`${OBSERVATION_LEDGER}\` in the repository the observation is about**`,
	'**It is append-only.**',
	// A run inside a consumer's repository that appended where it stood would scatter one phenomenon
	// across every consumer, and no key would ever reach a count of two.
	"**The count and the append are both run in that repository's checkout**",
	'**The subject decides, never the working directory**',
	'the append follows the subject, never the working directory',
	'**A third-party target gets no line either**',
	// An append-only file conflicts on every parallel lane, and the wrong resolution silently deletes
	// the repeat the whole mechanism reads.
	'**A merge conflict in it is resolved by keeping both sides**',
	'**The identity key is the whole of the repeat test — never a similarity judgement about the prose.**',
	// Without this the ledger reads as a way around joshuafolkken/kit#1698 rather than a destination
	// for what that gate turned away, which is the one misreading that would undo both changes.
	'**The depth gate is not withdrawn, and this is not a way around it.**',
]

// The grammar lives in the distributed skill rather than in `docs/`, which `package.json` does not
// ship: a consumer repository receives §2i and never receives the ledger, so a definition written
// only in the ledger would leave every consumer-side file shaped by hand.
const LEDGER_GRAMMAR_MARKERS: ReadonlyArray<string> = [
	'**One observation is one line: five fields, each separated from the next by a vertical bar with one space on either side.**',
	'| `k:<slug>` | The identity key',
	// `d0` is filed outright and never reaches the ledger, so a grammar admitting it would accept an
	// entry the routing rule says cannot exist.
	'**There is no `d0` line**',
	'`k:example` is reserved for this sample and is never used by a real observation',
	'**The grammar is defined here rather than in the ledger**',
	// `grep -c` exits non-zero on a count of zero, which is the first-sighting branch and the common
	// one — so the documented command has to carry the guard, not just the prose around it.
	'**The `|| true` is not decoration**',
	// `grep` exits 2 on a missing file and prints nothing, which the guard would otherwise launder
	// into a first sighting — the one reading that makes the promotion unreachable.
	'**A missing file is not a count of zero, though**',
	`grep -c '^- k:<slug> |' <that repository's checkout>/${OBSERVATION_LEDGER} || true`,
]

// The promotion. A count, not a judgement — which is what lets it stand in for the depth-0 citation
// joshuafolkken/kit#1698 asks for: an observation that came back was pulled by something, and a
// single sighting can never demonstrate that.
const SECOND_SIGHTING_MARKERS: ReadonlyArray<string> = [
	'### The second sighting is what files it',
	'**A repeat is the citation.**',
	// Exactly `1`, never "1 or more": at a higher count the Issue is already open, and a run reading
	// the looser threshold would file a duplicate on every third and later sighting.
	'**On the count answering exactly `1`, the observation is filed**',
	"**The Issue quotes the ledger's own dates — the first sighting's and this one's**",
	'**Both ceilings still apply**',
	'**A third and later sighting appends a line and files nothing more.**',
]

// The child's exclusion extends to the ledger, and for a reason the filing ceiling does not cover:
// parallel lanes would write one phenomenon under several keys, and each of those lines would then
// read as a first sighting — the exact state the ledger exists to end.
const CHILD_LEDGER_MARKERS: ReadonlyArray<string> = [
	'**A delegated child does not append to the ledger either — the parent collapses the duplicates and appends what is left.**',
	'the parent chooses the key, checks the count and writes the line',
]

// `epicrun.md` holds the child's return path, so the parent's new destination has to be readable from
// there too — a summary list that names only "the parent files what survives" reads as though an
// observation the parent does not file is still dropped.
const EPICRUN_LEDGER_MARKERS: ReadonlyArray<string> = [
	'**What the parent does with the rest is append it, not drop it**',
	'**The child never writes that file**',
]

// The ledger carries the rule it is read under by pointer rather than by copy — the rules this
// package states prohibit exactly that clone, and a second copy is what drifts.
const LEDGER_FILE_MARKERS: ReadonlyArray<string> = [
	'**The ledger is append-only.**',
	'A second sighting is a **second line with the same key**, not a rewrite of the first.',
	`\`.claude/skills/workflow-commands/SKILL.md\` → §2i, which is their single source`,
	'**A merge conflict here is resolved by keeping both sides.**',
]

// joshuafolkken/kit#1756: the ledger had a destination and no route out of the working tree a line
// was written in — the parent that appends never runs `pnpm josh git`, a child runs it in a lane
// work tree that cannot see the parent's checkout, and in the primary checkout `git add -u` swept
// the line into an unrelated pull request. So the count above was reading a file that is empty on
// every other machine. These markers pin the two halves of the route: that an ordinary commit cannot
// carry the ledger, and that one command does.
const COMMIT_PATH_MARKERS: ReadonlyArray<string> = [
	'### The commit path — how an appended line reaches the default branch',
	'**An append nobody commits is an append nobody can count**',
	'**structurally nobody was going to commit one**',
	'**An ordinary run never commits the ledger, and that is enforced rather than remembered.**',
	`**The parent flushes the ledger as a pull request of its own** — \`pnpm josh ${LEDGER_FLUSH_COMMAND}\``,
	'**Nothing is committed to the default branch directly**',
	// The rejected alternative, kept so the next reader proposes something else rather than reviving
	// the contamination the exclusion exists to end.
	"**Mixing the lines into a child's pull request was considered and is refused.**",
	'**Nothing to flush is an answer, not a failure.**',
	// Why the route matters at all: the repeat test is a count of what merged, never of what one
	// machine happens to hold.
	'**The count the promotion below reads is a count of the default branch**',
]

// The grammar, written once and asserted against both the documented sample and every real entry. A
// format defined in prose that no entry is checked against drifts on the first hand-written line.
const LEDGER_LINE_PATTERN =
	// `d[1-9]` rather than `d[1-2]`: the prose says "depth 1 or deeper" in three places, and a grammar
	// pinned to today's two-row depth table would reject a line that prose authorizes the day a third
	// row is added. `d0` stays excluded, because that one is filed outright and never reaches here.
	/^- k:[a-z0-9]+(?:-[a-z0-9]+)* \| d[1-9] \| \d{4}-\d{2}-\d{2} \| [^|]+ \| [^|]+$/u
const LEDGER_SAMPLE =
	'- k:example | d1 | 2026-09-10 | pnpm josh run:progress | The report printed a fill-in placeholder where a clock time belonged'
const LEDGER_SECTION_HEADING = '\n## Ledger\n'
const LEDGER_ENTRY_PREFIX = '- k:'
// Deliberately looser than the grammar: a malformed append is what has to fail, and a filter written
// as `startsWith('- k:')` would drop `* k:foo`, `-  k:foo` and `- key:foo` out of the sample
// entirely — leaving the suite green in exactly the state it exists to detect, while the documented
// `grep -c` misses the line too and the next sighting reads as a first one.
const LEDGER_BULLET_PATTERN = /^\s*[*+-]\s/u

// Entries are taken from below the `## Ledger` heading only: the sample above it is documentation,
// and counting it as an entry would make the very first real observation look like a repeat.
function ledger_entries(): ReadonlyArray<string> {
	const start = ledger_raw.indexOf(LEDGER_SECTION_HEADING)
	if (start === -1) return []

	return ledger_raw
		.slice(start + LEDGER_SECTION_HEADING.length)
		.split('\n')
		.filter((line) => LEDGER_BULLET_PATTERN.test(line))
}

// Read once: the ledger only grows, and three separate walks of the same file would drift apart the
// moment one of them learned to filter something the others do not.
const LEDGER_ENTRIES = ledger_entries()

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

	it.each(EPICRUN_LEDGER_MARKERS)("names the parent's ledger append: %j", (marker) => {
		expect(epicrun_text).toContain(marker)
	})
})

describe(`${WORKFLOW_SKILL} — an observation with no blockage to cite is recorded, not dropped`, () => {
	it.each(LEDGER_MARKERS)('states the ledger destination: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})

	it.each(LEDGER_GRAMMAR_MARKERS)('defines the line grammar where it ships: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})

	it.each(SECOND_SIGHTING_MARKERS)('promotes a repeat to a filing: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})

	it.each(CHILD_LEDGER_MARKERS)('withholds the ledger from a child: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})

	// The sample is what makes the grammar bite while the ledger is still empty: a pattern nothing is
	// ever matched against is a pattern that can be wrong without failing.
	it('carries a sample line that matches the grammar it documents', () => {
		expect(skill_text).toContain(LEDGER_SAMPLE)
		expect(LEDGER_SAMPLE).toMatch(LEDGER_LINE_PATTERN)
	})
})

describe(`${OBSERVATION_LEDGER} — the ledger is readable by the rule that names it`, () => {
	it.each(LEDGER_FILE_MARKERS)('points at the single source: %j', (marker) => {
		expect(ledger_unwrapped).toContain(marker)
	})

	// Asserted before the two entry checks below, both of which pass vacuously on an empty list: a
	// renamed heading would otherwise silence the whole entry half of this suite instead of failing it.
	it('keeps the heading the entries are read from', () => {
		expect(ledger_raw).toContain(LEDGER_SECTION_HEADING)
	})

	it('accepts only entries that match the documented grammar', () => {
		for (const entry of LEDGER_ENTRIES) expect(entry).toMatch(LEDGER_LINE_PATTERN)
	})

	// The identity key is the whole of the repeat test, so the sample's reserved key appearing as a
	// real entry would make the documented count command answer for a line that is documentation.
	it('keeps the reserved sample key out of the ledger itself', () => {
		const reserved = LEDGER_ENTRIES.filter((entry) =>
			entry.startsWith(`${LEDGER_ENTRY_PREFIX}example `),
		)

		expect(reserved).toEqual([])
	})

	// The ledger says how its own lines get committed, because whoever opens it after an append is
	// the person about to reach for `git add`.
	it('names the command that commits it', () => {
		expect(ledger_unwrapped).toContain(
			'**A line reaches `main` through `pnpm josh observations:flush`, never through an ordinary commit.**',
		)
	})
})

describe(`${WORKFLOW_SKILL} — an appended line has a route to the default branch`, () => {
	it.each(COMMIT_PATH_MARKERS)('states the commit path: %j', (marker) => {
		expect(skill_text).toContain(marker)
	})

	// A documented command the CLI does not have is a procedure that stops at its first step, which
	// is the failure this route was filed for arriving one layer down.
	it('is a command the CLI actually dispatches', () => {
		expect(Object.keys(COMMAND_MAP)).toContain(LEDGER_FLUSH_COMMAND)
	})

	it('is documented where the other josh commands are', () => {
		expect(read_unwrapped(JOSH_COMMANDS_DOC)).toContain(`pnpm josh ${LEDGER_FLUSH_COMMAND}`)
	})
})

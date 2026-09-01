import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, read_unwrapped } from './ai-document-fixture'
import { IN_PROGRESS_LABEL, NEEDS_DECISION_LABEL } from './git/issue-labels'

// joshuafolkken/kit#891: "something else has to land first" is the third thing a run can discover,
// and it was the only one with no procedure. The two it sits between — an upstream defect, a split —
// both end in a stop, so the nearest written rule was the one that parks. Parking a prerequisite
// that `blocked-by` could express is what makes an unattended run need a person: `needs-decision` is
// cleared by hand. These markers pin the parts a reword most easily loses — that the run does *not*
// park, the condition under which it may, and the ceiling that replaces the removed confirmation.
//
// joshuafolkken/kit#1185: the rule body is single-sourced into the skill and the canonical topic
// file is now a pointer to it (the joshuafolkken/kit#1174 pattern, rolled out under
// joshuafolkken/kit#1176). The canonical was formerly a Japanese full copy asserted here marker for
// marker; those assertions become the skill-only suite, the fold-in suite that pins what the
// canonical alone used to carry, and the pointer suite at the bottom.
//
// The entry-independent half of the rule sits in `SKILL.md` §2d rather than in one entry's file:
// the three-way separation of an upstream defect, a split and a prerequisite is the same at every
// entry point, so a copy per entry would be the clone this rollout removes. Each entry's own branch
// stays in that entry's file, which is where the numbered procedure has always lived.

const WORKFLOW_SKILL = '.claude/skills/workflow-commands/SKILL.md'
const EPICRUN_SKILL = '.claude/skills/workflow-commands/epicrun.md'
const FULLRUN_SKILL = '.claude/skills/workflow-commands/fullrun.md'
const HALFRUN_SKILL = '.claude/skills/workflow-commands/halfrun.md'
const SPLIT_SKILL = '.claude/skills/workflow-commands/split-assessment.md'
const CANONICAL = 'prompts/collaboration-workflow/prerequisite-issue.md'
const STOPPING_ENTRY_SKILLS: ReadonlyArray<string> = [FULLRUN_SKILL, HALFRUN_SKILL]
// Every entry that asks `epic:bundle` before creating an epic, and so has to read its warnings.
const BUNDLE_CALLING_SKILLS: ReadonlyArray<string> = [EPICRUN_SKILL, ...STOPPING_ENTRY_SKILLS]
const PARK_ONLY_FOR = 'Parking is only for a prerequisite that cannot be expressed as a dependency'
// A stash without `-u` leaves the new `*.test.ts` behind, which is the whole failure the step names.
const UNTRACKED_REQUIRED = '**`-u` is not optional**'

// Read from the document itself rather than from the rule surface: the surface concatenates every
// distributed skill, so a marker checked there would pass on the skill's copy alone — which is
// exactly the drift these paired documents exist to prevent.
//
// joshuafolkken/kit#951 moved the rule out of the documents and into the skill: it binds only after
// a command has started, so restating it resident spent always-loaded budget that
// `workflow-skills.test.ts` then caps. What is pinned here is the routing — the rule is named, and
// the files that carry the definition and each branch are named.
const AI_DOC_MARKERS: ReadonlyArray<string> = [
	'Three rules decide what a run does when the work turns out not to be one Issue',
	'a prerequisite discovered mid-run (filed and recorded as a dependency, not parked)',
	'`fullrun.md` / `halfrun.md` / `epicrun.md`',
	'`SKILL.md` → §2d',
]

// The single source's own statement of the rule. The procedure stays in the per-entry files, which
// the suites below assert.
const ENTRY_MARKERS: ReadonlyArray<string> = [
	'**A prerequisite discovered mid-run is a dependency, not a park.**',
	'continues rather than parking it',
	'**Automatic filing is capped at 10 Issues per run** at every entry point',
	'`kickoff` is exempt — it never implements, so it never discovers one',
	// The command is what makes the `epicrun` branch possible; without it the procedure is "edit the
	// body", which is the state joshuafolkken/kit#890 exists to remove.
	'pnpm josh epic --add <E> <N> --before <M>',
]

const EPICRUN_SKILL_MARKERS: ReadonlyArray<string> = [
	'## A prerequisite discovered mid-run',
	'**Do not park.**',
	PARK_ONLY_FOR,
	// joshuafolkken/kit#943: `epicrun #N` can be typed on an Issue an epic already tracks, and
	// creating a second one there has the auto-close reading two task lists that disagree.
	'Ask `pnpm josh epic:bundle <N>` whether an epic already tracks `#<N>` before creating one',
	// The loop is where a reader following the run arrives, so the branch has to be stated there.
	'`epic:next` classifies the original child as resolving on its own',
	`**Remove \`${IN_PROGRESS_LABEL}\` from \`<M>\`.**`,
	'**Stash the work in progress.**',
	UNTRACKED_REQUIRED,
	'It is filed **first** because the next step has to name it',
]

const STOPPING_ENTRY_MARKERS: ReadonlyArray<string> = [
	'A prerequisite Issue discovered mid-run stops this command too',
	'without asking',
	'a batch is a different authorization',
	'Automatic filing is capped at 10 Issues per run',
	'**Find out whether `#N` already belongs to an epic, before creating one**',
	'`pnpm josh epic --add <E> <P> --before <N>`',
	'**Do not create a second one**',
	// "could not tell" read as "no epic tracks it" recreates the duplicate this step prevents.
	'**The command could not answer**',
	'**Do not fall through to creating an epic**',
	// The command can refuse; without this the procedure dead-ends with the work stashed.
	'**`#N` needs no place in the declared order for this to work.**',
	'declares a new chain `#<P> -> #N` beside the existing ones rather than refusing',
	'It still refuses a target the epic does not track at all',
	'**`--ordered` is required, not stylistic**',
	`**Remove \`${IN_PROGRESS_LABEL}\` from \`#N\`**`,
	'**Stash the work in progress**',
	UNTRACKED_REQUIRED,
	'**The Issue comment is what gets the stash popped**',
	'It goes first because the steps below name it.',
	'Please run `epicrun #<E>` to execute this epic.',
]

describe('prerequisite-issue definition', () => {
	it.each(AI_DOCS)('is routed to from %s, by name and by file', (document_name) => {
		const content = read_unwrapped(document_name)

		for (const marker of AI_DOC_MARKERS) expect(content).toContain(marker)
	})

	it('states the rule in the skill section that is its single source', () => {
		const content = read_unwrapped(WORKFLOW_SKILL)

		for (const marker of ENTRY_MARKERS) expect(content).toContain(marker)
	})
})

// What the canonical alone used to carry. `SKILL.md` → "Trimming is moving, never deleting.": each
// of these had to exist in the single source before the Japanese full copy was cut, so they are
// pinned by name rather than left to be noticed missing later.
const unwrapped = read_unwrapped(WORKFLOW_SKILL)

describe(`${WORKFLOW_SKILL} — carries the origin and the entry condition`, () => {
	// Why the rule was filed at all. Dropped, a prerequisite reads as whichever adjacent rule the
	// reader reaches for first — and both of those end in a stop, which is the wrong answer here.
	it('names the origin and why a prerequisite had no procedure of its own', () => {
		expect(unwrapped).toContain('joshuafolkken/kit#891')
		expect(unwrapped).toContain('the nearest written rule was the one that parks')
	})

	// The table is the rule's entry condition: an agent that cannot tell the three apart applies the
	// wrong procedure before reaching any of the steps.
	it('separates the three kinds of other work a run can discover', () => {
		expect(unwrapped).toContain('Three kinds of other work turn up mid-run')
		expect(unwrapped).toContain('A defect originating in **another package**')
		expect(unwrapped).toContain('This Issue was really **several** (a split)')
		expect(unwrapped).toContain('has to land first (**a prerequisite**)')
	})

	// The entry files restate the instruction in prose; the raw command with its label flag lived
	// only in the canonical, and `filing-route-label.test.ts` keys the route count to it.
	it('gives the filing command with its route label', () => {
		expect(unwrapped).toContain("-f 'labels[]=route:tier-a'")
		expect(unwrapped).toContain('joshuafolkken/kit#1083')
	})
})

describe(`${WORKFLOW_SKILL} — carries the reasoning behind each shared step`, () => {
	// Both halves of the stash step's reasoning. An agent told to pass `-u` without being told what
	// it saves will drop it the first time the flag is inconvenient, and a stash recorded only in a
	// Telegram is work nobody pops.
	it('says why the stash needs `-u` and why the record is the Issue comment', () => {
		expect(unwrapped).toContain('the `-u` is not optional')
		expect(unwrapped).toContain(
			'**The Issue comment is what gets the stash popped, not the Telegram.**',
		)
	})

	// The inversion, not merely the prohibition: parking in the name of unattended execution is what
	// makes the run need a person, and that sentence is the reason the branch exists.
	it('states the condition under which parking is still right, and its cost', () => {
		expect(unwrapped).toContain('*cannot* be expressed as a dependency')
		expect(unwrapped).toContain(
			'a park taken in the name of unattended execution is what makes the run need one',
		)
	})

	// The three-way table is read by every entry, so a wrong row here propagates further than the
	// same error in one entry file. `epicrun` does **not** stop on a split — its authorization
	// already covers a batch (`split-assessment.md` → "`epicrun` is the one entry that does not
	// stop") — and a row saying otherwise would have an unattended run stop or park where it should
	// file and continue.
	it('does not claim a split stops an epicrun', () => {
		expect(unwrapped).toContain(
			'except under `epicrun`, whose authorization already covers a batch',
		)
	})

	// The ceiling replaced the confirmation. Without the reason it reads as an arbitrary number and
	// the next reader raises it.
	it('ties the filing ceiling to the confirmation it replaced', () => {
		expect(unwrapped).toContain(
			'Removing the confirmation removes the only thing that stopped a chain of false positives',
		)
	})
})

describe('prerequisite-issue definition — the skills', () => {
	it('carries the unattended branch in the epicrun skill', () => {
		const content = read_unwrapped(EPICRUN_SKILL)

		for (const marker of EPICRUN_SKILL_MARKERS) expect(content).toContain(marker)
	})

	it.each(STOPPING_ENTRY_SKILLS)('carries the stopping branch in %s', (skill) => {
		const content = read_unwrapped(skill)

		for (const marker of STOPPING_ENTRY_MARKERS) expect(content).toContain(marker)
	})

	// joshuafolkken/kit#1067: a truncated epic listing and a failed relation read print warnings that
	// look alike, and only one of them means the verdict cannot be trusted. The distinction lived in
	// the canonical alone until this rollout folded it into every entry that calls `epic:bundle` —
	// `epicrun` included, where mis-reading it parks a child that needed no parking.
	it.each(BUNDLE_CALLING_SKILLS)('tells %s which warning voids the verdict', (skill) => {
		const content = read_unwrapped(skill)

		expect(content).toContain('⚠ The epic listing …')
		expect(content).toContain('joshuafolkken/kit#1067')
	})

	// Each entry's branch has to say where the definition is, or the three-way distinction is read
	// off whichever entry file the run happened to open.
	it.each(BUNDLE_CALLING_SKILLS)('routes %s to the single source', (skill) => {
		expect(read_unwrapped(skill)).toContain('`SKILL.md` → §2d, which is the single source')
	})
})

// The boundaries: each of these pins the rule apart from an adjacent one it would otherwise be read
// as, which is the failure mode joshuafolkken/kit#891 was filed for.
describe('prerequisite-issue definition — what it must not be read as', () => {
	// A prerequisite read as a split goes down a procedure that stops even inside an `epicrun`,
	// which is the failure this whole rule exists to remove.
	it('separates a prerequisite from a split where the split is assessed', () => {
		const content = read_unwrapped(SPLIT_SKILL)

		expect(content).toContain('## A prerequisite is not a split')
		expect(content).toContain('it is still **one** deliverable that has another one in front of it')
	})

	// The paragraph was written for `fullrun` and copied into `halfrun`, where "approved … merging"
	// contradicts the same file's "Invoking `halfrun` is _not_ authorization to commit, push, or
	// merge" — a distributed document that authorizes a merge it forbids two paragraphs later.
	it('does not tell halfrun it was authorized to merge', () => {
		expect(read_unwrapped(HALFRUN_SKILL)).not.toContain(
			'Typing `halfrun` approved implementing and merging',
		)
	})

	it('names the label a park would apply, so the cost of parking is visible', () => {
		expect(read_repo_file(EPICRUN_SKILL)).toContain(NEEDS_DECISION_LABEL)
	})

	// The split procedure had told the reader to edit the epic body; a leftover instruction to do so
	// is the defect joshuafolkken/kit#890 removed the need for.
	it('routes the mid-run split through the command rather than a hand edit', () => {
		const content = read_unwrapped(EPICRUN_SKILL)

		expect(content).toContain('pnpm josh epic --add <E> <N...>')
		expect(content).toContain('rather than editing the epic body by hand')
	})
})

// joshuafolkken/kit#1185: the canonical topic file is a pointer to the skill single source, not a
// second copy. The pointer test names the source; the body test proves the Japanese full copy that
// used to live here — asserted marker for marker until this rollout — has not crept back.
describe('the canonical topic file is a pointer to the skill single source', () => {
	const POINTER_MARKERS: ReadonlyArray<string> = [WORKFLOW_SKILL, 'クローン禁止・単一ソース化']
	// One marker per section the Japanese body used to carry, not merely a couple. The generic size
	// check in `pointer-citation-document-rule.test.ts` compares this pointer against the whole of
	// `SKILL.md`, so a single paragraph creeping back would stay far under it and pass — the
	// paragraph-level guard has to live here.
	const REMOVED_BODY_MARKERS: ReadonlyArray<string> = [
		'これは分割ではない',
		'park しない',
		'park は依存として表現できない場合に限る',
		'park したことで人が必要になる',
		'この停止は残す',
		'**`--ordered` は必須であって好みの問題ではない。**',
		'新規 EPIC を作る前に、`#N` が既に EPIC の子でないかを確かめる',
		'**2 つ目を作ってはならない。**',
		'**EPIC 作成へ落ちてはならない。**',
		'**`#N` が宣言された順序に載っていなくても構わない。**',
		'blocker を見る前に',
		'git stash push -u -m',
		'**`-u` は省略できない。**',
		'確認という歯止めを外す以上、上限を付ける',
	]

	const pointer = read_unwrapped(CANONICAL)

	// Named per marker rather than looped inside one case: a failure has to say which marker went
	// missing, not only that the first one did.
	it.each(POINTER_MARKERS)('names the skill as the single source: %j', (marker) => {
		expect(pointer).toContain(marker)
	})

	it.each(REMOVED_BODY_MARKERS)('does not duplicate the rule body: %j', (marker) => {
		expect(pointer).not.toContain(marker)
	})

	// A back-reference from the single source itself costs no second hop, and it is what tells a
	// reader who landed on the skill that the topic file holds no body.
	it('is named as a pointer by the skill that now holds the body', () => {
		expect(read_unwrapped(WORKFLOW_SKILL)).toContain(`\`${CANONICAL}\` is a pointer to it`)
	})
})

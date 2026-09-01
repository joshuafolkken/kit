import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
	AI_DOCS,
	read_repo_file,
	read_unwrapped,
	read_unwrapped_rule_surface,
} from './ai-document-fixture'
import { package_file } from './skill-fixture'

const SCRIPTS_ROOT = 'scripts'
const LABEL_MODULE = 'scripts/git/issue-labels.ts'
const LABEL_LITERAL = "'needs-human-review'"
const CANONICAL = 'prompts/collaboration-workflow/human-review-label.md'
const SKILL = '.claude/skills/workflow-commands/SKILL.md'

// joshuafolkken/kit#1125: the label's whole value is in four prohibitions and one distinction, and a
// document that keeps the label and loses any of them is worse than not having it. Lose "commit
// nothing" and the artifact ships; lose "stop the run" and the next child starts on a dirty tree;
// lose "do not stash" and the work a person is meant to look at is hidden; lose "only a person
// applies it" and an unattended run clears its own mark. Lose the `needs-decision` distinction and
// somebody parks the issue instead, which means it is never implemented at all.
//
// joshuafolkken/kit#1184: the rule body is single-sourced into the skill and the canonical topic file
// is now a pointer to it (the joshuafolkken/kit#1174 pattern, rolled out under
// joshuafolkken/kit#1176). The canonical was formerly a Japanese full copy asserted here beside the
// rule surface, marker for marker; those paired assertions become surface-only ones, plus the
// folded-in suite that pins what the canonical alone used to carry and the pointer suite at the
// bottom.

const SURFACE_MARKERS: ReadonlyArray<string> = [
	'`needs-human-review`',
	// The degradation itself, and the three things it withholds.
	'degraded to a `halfrun`-shaped stop',
	'Nothing is committed, pushed, opened as a pull request or merged',
	'The working tree is left uncommitted, and nothing is stashed',
	// Inside an `epicrun` this is the one stop that does not become a park.
	'stop the whole run',
	'The remaining children are not started',
	'the one thing that is *not* park-and-continue',
	// The `auto-ok`-strength prohibition. A mark a run can clear for itself is not a mark.
	'Never apply or remove it',
	// The distinction that keeps it from being applied as a park — and the two sets that encode it.
	'It is not `needs-decision`',
	'goes on holding its repository',
	'the resume command',
	// joshuafolkken/kit#1132: the stop must not rest on an agent matching the label string by eye.
	'Read the answer from `pnpm josh issue:state <N>`, never by matching the label string yourself',
	// With no pull request there is no CI E2E job and `followup --merge` is never reached, so the gate
	// closes only if the run executes the suite itself — `halfrun`'s situation exactly.
	'Run `pnpm josh test:e2e` yourself before stopping',
	// The delegated child comes back OPEN without `needs-decision`, which the failure branch would
	// otherwise claim: it strips `in-progress`, releasing the repository the stopped child must keep.
	// Decided from the command's own line rather than by eye — joshuafolkken/kit#1132.
	'**Open, and `human_review: yes`**',
	'Read that line, not the `labels:` one',
	// The check has to happen before implementation; the post-return confirmation is too late.
	'Ask once, before implementing',
	'Leave `in-progress` **on**',
	// A batch that halts on its first such issue is the intended end, not a run that broke. Read the
	// other way, the next reader removes the stop to keep the batch moving.
	'Stopping is the specification, not a failure',
	// The label is a person's to create as well as to apply, so the command belongs in the single
	// source rather than only in `docs/`, which a consumer does not receive.
	'-f name=needs-human-review -f color=d93f0b',
]

describe('the human-review label rule reaches the rule surface', () => {
	it.each(SURFACE_MARKERS)('states %s', (marker) => {
		expect(read_unwrapped_rule_surface(AI_DOCS[0] ?? '')).toContain(marker)
	})
})

// What the canonical alone used to carry. `SKILL.md` → "Trimming is moving, never deleting.": each
// of these had to exist in the single source before the Japanese full copy was cut, so they are
// pinned by name rather than left to be noticed missing later.
describe(`${SKILL} — carries what only the canonical used to give`, () => {
	const unwrapped = read_unwrapped(SKILL)

	// Why the label was filed at all, and the two shapes of work it was filed for. Dropped, the label
	// reads as a mood — "stop when it feels important" — rather than as the one requirement no test
	// can stand in for.
	it('names the origin and the two kinds of work it was filed for', () => {
		expect(unwrapped).toContain('joshuafolkken/kit#1125')
		expect(unwrapped).toContain("some work's quality is not something a test can judge")
		expect(unwrapped).toContain('published artifact')
		expect(unwrapped).toContain("a choice that was a person's to make")
	})

	// Each of the three things somebody reaches for instead, and why each fails. Without them the
	// next reader re-derives the wrong one — and `needs-decision` is the wrong one that looks right.
	it('says why every already-available means fails', () => {
		expect(unwrapped).toContain('Pre-applying `needs-decision` is worse than useless')
		expect(unwrapped).toContain('carries no force')
		expect(unwrapped).toContain('Withholding `auto-ok` does nothing whatever')
	})

	// The batch-preserving alternative was the early recommendation, so its rejection is the part a
	// reader is most likely to want to reopen. Both arms of the requirement, and both rejected cases.
	it('records the alternatives that were rejected and what each one failed', () => {
		expect(unwrapped).toContain('Opening the pull request and leaving it unmerged')
		expect(unwrapped).toContain('changes from **choosing** to reverting what was chosen')
		expect(unwrapped).toContain('thirteen children, thirteen stashes')
	})

	// joshuafolkken/kit#1132's reason, not merely its instruction: an agent told to run the command
	// without being told what an eye-match misses will fall back to the eye the first time the
	// command is inconvenient.
	it('gives the spelling reason behind reading the command output', () => {
		expect(unwrapped).toContain('GitHub keeps the spelling a label was created with')
		expect(unwrapped).toContain('joshuafolkken/kit#1132')
	})

	// Both halves of the `needs-decision` distinction as the code encodes them. Named as the two sets
	// the label is kept *out* of, because that is the shape a reader has to check the code against.
	it('names the two sets the label is deliberately kept out of', () => {
		expect(unwrapped).toContain('NOT_DIRECTLY_RUNNABLE_LABELS')
		expect(unwrapped).toContain('keeps it out of the parked set')
	})

	// The stop is only half an instruction without the way back out of it.
	it('says how the stop is resumed', () => {
		expect(unwrapped).toContain("Resuming is `halfrun`'s stop exactly")
	})
})

// Every production TypeScript file under `scripts/`, so the assertion below covers the tree rather
// than a list somebody has to remember to extend. Test files are excluded deliberately: asserting the
// exact spelling is what `issue-labels.test.ts` is for, and this suite has to name it too.
function script_files(): ReadonlyArray<string> {
	return readdirSync(package_file(SCRIPTS_ROOT), { encoding: 'utf8', recursive: true })
		.filter((entry) => entry.endsWith('.ts') && !entry.endsWith('.test.ts'))
		.map((entry) => `${SCRIPTS_ROOT}/${entry}`)
}

describe('the label is single-sourced rather than typed into prose', () => {
	// The name is the contract with GitHub. A document may spell it, but the code must read it from
	// one constant — a second literal is the copy that drifts without anything failing.
	it('defines the name once, in the label module', () => {
		expect(read_repo_file(LABEL_MODULE)).toContain(
			`const NEEDS_HUMAN_REVIEW_LABEL = ${LABEL_LITERAL}`,
		)
	})

	// Named paths would have guarded two files and claimed to guard every one, so the whole script
	// tree is walked. The label module is the one place the literal may appear.
	it('is not typed as a literal anywhere else in the scripts', () => {
		const offenders = script_files()
			.filter((path) => path !== LABEL_MODULE)
			.filter((path) => read_repo_file(path).includes(LABEL_LITERAL))

		expect(offenders).toEqual([])
	})
})

// joshuafolkken/kit#1184: the canonical topic file is a pointer to the skill single source, not a
// second copy. The pointer test names the source; the body test proves the Japanese full copy that
// used to live here — asserted marker for marker above until this rollout — has not crept back.
describe('the canonical topic file is a pointer to the skill single source', () => {
	const POINTER_MARKERS: ReadonlyArray<string> = [SKILL, 'クローン禁止・単一ソース化']
	// One marker per section the Japanese body used to carry, not merely a couple. The generic size
	// check in `pointer-citation-document-rule.test.ts` compares this pointer against the whole of
	// `SKILL.md`, so a single paragraph creeping back would stay far under it and pass — the
	// paragraph-level guard has to live here.
	const REMOVED_BODY_MARKERS: ReadonlyArray<string> = [
		'成果物の良し悪しは機械では測れない',
		'候補画像からの採用決定など',
		'Issue 本文に「`halfrun` で実行すること」と書いても強制力が無く',
		'検討した 3 案のうち',
		'子が 13 件なら stash も 13 個になる',
		'最後の行が最も重要である',
		'理由は綴りである',
		'自分で外せる印は印として機能せず',
		'ラベルはリポジトリごとに一度作る',
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
		expect(read_unwrapped(SKILL)).toContain(`\`${CANONICAL}\` is a pointer to it`)
	})
})

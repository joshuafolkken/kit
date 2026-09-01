import { read_unwrapped } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#985: `kickoff new` and its siblings file an Issue and say nothing about which
// epic it belongs to, so the instruction was retyped by hand every time — and a run that forgot it
// left an Issue no epic tracks, which `epic:next` never offers again. The suffix replaces that
// three-line block, and the grammar only helps if a run and a person read the same one.
//
// joshuafolkken/kit#1181: the `into <target>` body is single-sourced into the skill and the canonical
// topic file is now a pointer to it (the joshuafolkken/kit#1174 pattern, rolled out under
// joshuafolkken/kit#1176). The canonical was formerly a Japanese full copy asserted here beside the
// skill, marker for marker; those paired assertions become skill-only ones, plus the folded-in suite
// that pins what the canonical alone used to carry and the pointer suite at the bottom.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CANONICAL = 'prompts/collaboration-workflow/into-epic.md'

// One per entry point that creates something. `queue` and `epicrun` are absent on purpose: neither
// files a top-level artifact of its own.
const ENTRY_POINTS: ReadonlyArray<string> = [
	'kickoff new into',
	'fullrun new into',
	'halfrun new into',
]

describe(`${SKILL} — the suffix is written down`, () => {
	const unwrapped = read_unwrapped(SKILL)

	it.each(ENTRY_POINTS)('accepts %j', (form) => {
		expect(unwrapped).toContain(form)
	})

	// The title form is the one that would read as ambiguous if it were left out: `into` after a
	// quoted title has to be the suffix rather than part of the title.
	it('shows the form that follows a quoted title', () => {
		expect(unwrapped).toContain('kickoff new "<title>" into #909')
	})

	// A bare `#N` would resolve to this repository's issue of that number — a different issue.
	it('shows the cross-repository form', () => {
		expect(unwrapped).toContain('into joshuafolkken/kit#909')
	})

	// The rule that folds the two prose lines into one: whichever artifact is top-level goes in.
	it('says one artifact goes in, and which', () => {
		expect(unwrapped).toContain('One artifact goes in')
	})

	// Insertion at the end would leave exactly the orphan the suffix exists to prevent whenever a run
	// stops halfway.
	it('puts the insertion before implementation, not after', () => {
		expect(unwrapped).toContain('as soon as the artifact exists')
	})

	// Hand-editing the body is what makes the declaration and the relations disagree, which stops an
	// unattended run outright.
	it('routes the insertion through the command', () => {
		expect(unwrapped).toContain('pnpm josh epic --add')
	})

	it('requires the position rationale to be recorded', () => {
		expect(unwrapped).toContain('record why')
	})

	// Promoting on the run's own initiative rewrites someone's issue into a container; which arm
	// applies depends on what the target is, so the command refuses and names both.
	it('refuses a target that is not an epic rather than promoting it', () => {
		expect(unwrapped).toContain('Never promote on your own')
		expect(unwrapped).toContain('--promote')
	})

	// Without this the suffix would be a behavior change for every run that does not use it.
	it('says an omitted suffix changes nothing', () => {
		expect(unwrapped).toContain('No suffix leaves the behavior exactly as it was')
	})
})

// The half the canonical alone used to carry. `SKILL.md` → "Trimming is moving, never deleting.":
// each of these had to exist in the single source before the Japanese full copy was cut, so they are
// pinned by name rather than left to be noticed missing later.
describe(`${SKILL} — carries what only the canonical used to say`, () => {
	const unwrapped = read_unwrapped(SKILL)

	// The filing this suffix came from, and the shape of what it replaced.
	it('names the origin and the hand-typed lines it replaced', () => {
		expect(unwrapped).toContain('joshuafolkken/kit#985')
		expect(unwrapped).toContain('the same three lines were typed by hand every time')
	})

	// Every other spelling collides with a form that already means something else, which is the whole
	// reason the grammar is this one. Dropped, the next editor re-opens a decision already made.
	it('says why the spelling is `into` rather than an alternative', () => {
		expect(unwrapped).toContain('`kickoff new #909` reads as the existing `kickoff #N`')
	})

	// "Record why" without the criteria leaves a run inventing an order and then justifying it.
	it('says what the position is decided by', () => {
		expect(unwrapped).toContain('compounds over the remaining children')
		expect(unwrapped).toContain('already in progress is never jumped ahead of')
	})

	// The refusal is a design decision, not a missing feature: which arm is right depends on what the
	// target is, so the command hands the choice back rather than guessing.
	it('says why the command will not promote by itself', () => {
		expect(unwrapped).toContain('rewrites someone else')
		expect(unwrapped).toContain('structural change rather than an insertion')
	})

	// Running `epic --add` in the wrong checkout is the common mistake, and the recovery is the
	// command it prints back.
	it('says the wrong-repository refusal answers with the command to retype', () => {
		expect(unwrapped).toContain('the command to retype')
		expect(unwrapped).toContain('pnpm josh doctor')
	})

	// The two routes are easy to collapse into one, and collapsing them would silently drop the
	// `epic:bundle` call that follows every filing.
	it('separates the explicit route from the recommendation', () => {
		expect(unwrapped).toContain('It is not `epic:bundle`, and both still run.')
	})
})

// joshuafolkken/kit#1181: the canonical topic file is a pointer to the skill single source, not a
// second copy. The pointer test names the source; the body test proves the Japanese full copy that
// used to live here — asserted marker for marker above until this rollout — has not crept back.
describe('the canonical topic file is a pointer to the skill single source', () => {
	const POINTER_MARKERS: ReadonlyArray<string> = [SKILL, 'クローン禁止・単一ソース化']
	// One marker per section the Japanese body used to carry, not merely a couple. The generic
	// size check in `pointer-citation-document-rule.test.ts` compares this pointer against the whole
	// of `SKILL.md`, so a single paragraph creeping back would stay far under it and pass — the
	// paragraph-level guard has to live here.
	const REMOVED_BODY_MARKERS: ReadonlyArray<string> = [
		'kickoff new into #909',
		'打ち忘れた回の Issue はどの EPIC にも属さない',
		'成果物が存在した時点で入れる',
		'位置の判断は対象 EPIC が既に採ってきた基準に従う',
		'昇格が他人の Issue を容れ物へ書き換える構造変更であり',
		'`into owner/repo#N` は正しい書式である',
		'推薦は信号が弱ければ何もしないが',
	]

	it('names the skill as the single source', () => {
		const content = read_unwrapped(CANONICAL)

		for (const marker of POINTER_MARKERS) expect(content).toContain(marker)
	})

	it('does not duplicate the rule body', () => {
		const content = read_unwrapped(CANONICAL)

		for (const marker of REMOVED_BODY_MARKERS) expect(content).not.toContain(marker)
	})

	// A back-reference from the single source itself costs no second hop, and it is what tells a
	// reader who landed on the skill that the topic file holds no body.
	it('is named as a pointer by the skill that now holds the body', () => {
		expect(read_unwrapped(SKILL)).toContain(`\`${CANONICAL}\` is a pointer to it`)
	})
})

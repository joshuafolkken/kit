import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#985: `kickoff new` and its siblings file an Issue and say nothing about which
// epic it belongs to, so the instruction was retyped by hand every time — and a run that forgot it
// left an Issue no epic tracks, which `epic:next` never offers again. The suffix replaces the three
// prose lines, and the grammar only helps if a run and a person read the same one.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CANONICAL = 'prompts/collaboration-workflow/into-epic.md'
const BOTH: ReadonlyArray<string> = [SKILL, CANONICAL]

// One per entry point that creates something. `queue` and `epicrun` are absent on purpose: neither
// files a top-level artifact of its own.
const ENTRY_POINTS: ReadonlyArray<string> = [
	'kickoff new into',
	'fullrun new into',
	'halfrun new into',
]

describe.each(BOTH)('%s — the suffix is written down', (document_path) => {
	const unwrapped = read_unwrapped(document_path)

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
		expect(unwrapped).toMatch(/One artifact goes in|入るのは「そのランが作った最上位の成果物」/u)
	})

	// Insertion at the end would leave exactly the orphan the suffix exists to prevent whenever a run
	// stops halfway.
	it('puts the insertion before implementation, not after', () => {
		expect(unwrapped).toMatch(/as soon as the artifact exists|作成直後、実装の前/u)
	})

	// Hand-editing the body is what makes the declaration and the relations disagree, which stops an
	// unattended run outright.
	it('routes the insertion through the command', () => {
		expect(unwrapped).toContain('pnpm josh epic --add')
	})

	it('requires the position rationale to be recorded', () => {
		expect(unwrapped).toMatch(/record why|根拠は対象 EPIC の本文か Issue コメントに残す/u)
	})

	// Promoting on the run's own initiative rewrites someone's issue into a container; which arm
	// applies depends on what the target is, so the command refuses and names both.
	it('refuses a target that is not an epic rather than promoting it', () => {
		expect(unwrapped).toMatch(/Never promote on your own|勝手に行わない/u)
		expect(unwrapped).toContain('--promote')
	})

	// Without this the suffix would be a behavior change for every run that does not use it.
	it('says an omitted suffix changes nothing', () => {
		expect(unwrapped).toMatch(
			/No suffix leaves the behavior exactly as it was|接尾辞が無いときの挙動は変わらない/u,
		)
	})
})

// The skill is what a run reads; the canonical is where a disagreement is settled. A skill that does
// not name the canonical leaves the second unreachable.
describe(`${SKILL} — points at the canonical`, () => {
	it('names the topic file', () => {
		expect(read_repo_file(SKILL)).toContain(CANONICAL)
	})
})

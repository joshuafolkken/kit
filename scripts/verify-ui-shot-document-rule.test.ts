import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, read_rule_surface } from './ai-document-fixture'

// joshuafolkken/kit#883. The UI verification gate used to assert that no toolkit shipped a
// screenshot command. It had been true; app-kit 0.86.0 made it false, and the sentence stayed. That
// is the defect worth guarding rather than the wording: the `verify-ui` skill already tells the
// reader to decide from the printed command list, but a flat "there is none today" placed just
// above it forestalls the check, and a reader who stops there rewrites test code to add a
// `page.screenshot()` while `pnpm josh-app shot` sits unused. The AI documents carry the same
// sentence as resident text, so they are read before the skill is even loaded.
//
// This suite is written so a claim about a toolkit cannot go stale silently again: a statement of
// fact about what ships is checked to be accompanied by the instruction that overrides it.

const SKILL = '.claude/skills/verify-ui/SKILL.md'
// `read_rule_surface` covers the AI document plus every distributed skill — and stops there. The
// same claim was also written into the package's own documentation, which is outside that surface,
// so the correction landed everywhere the guard could see and survived in the one place it could
// not. Naming the file explicitly is what closes that hole; a claim about a toolkit version written
// anywhere else in `docs/` belongs on this list the day it is written.
const EXTRA_CLAIM_SURFACES: ReadonlyArray<string> = ['docs/sync.md']

// The two spellings the correction retired. Asserted as absences across the whole rule surface,
// which is every distributed skill as well as the document — a sentence moved between them is not
// a sentence removed.
const RETIRED_CLAIMS: ReadonlyArray<string> = [
	'No toolkit ships that command yet',
	'Neither toolkit carries `shot` yet',
]

// What replaced them has to distinguish the two toolkit versions. "Some toolkit might have it" would clear
// the absence guards above while telling the reader nothing they can act on.
const APP_KIT_SHIPS = '`@joshuafolkken/app-kit` ships that command as `pnpm josh-app shot`'
const GAME_KIT_DOES_NOT = '`@joshuafolkken/game-kit` does not yet'

// The half that survives every future toolkit release. A claim about what ships is true of a
// version; this instruction is what makes the reader check theirs, which is why the correction had
// to keep it rather than simply swapping one factual assertion for another.
//
// Two spellings, one for each surface, and they are deliberately not merged. The documents must
// carry their own copy: they are resident text read before any skill loads, so a reader who acts on
// the resident claim alone never reaches the skill's version of this instruction.
const DECIDE_BY_LIST_SKILL = 'Decide by the printed command list'
const DECIDE_BY_LIST_DOCUMENT = 'decide by the command list the toolkit prints'

// #883 asked for a correction, not a deletion. The fallback is what closes the gate in a project
// with no screenshot command at all, and removing it while fixing the sentence above it would trade
// a stale claim for a gate that cannot be closed.
const FALLBACK_MARKERS: ReadonlyArray<string> = [
	// Matched open-ended: the AI documents name the call as `page.screenshot()` and the skill spells
	// out its argument, and the guard is about the fallback existing, not about how it is punctuated.
	'page.screenshot(',
	'Otherwise stop and say so',
	'Never report the gate as satisfied on tests alone',
]

describe('verify-ui screenshot command claim', () => {
	it.each(AI_DOCS)('%s no longer claims no toolkit ships the command', (document_name) => {
		const surface = read_rule_surface(document_name)

		for (const claim of RETIRED_CLAIMS) {
			expect(surface).not.toContain(claim)
		}
	})

	// The package's own documentation said the same thing in its own words, and no rule surface
	// reaches it. Asserted on the phrases rather than on a rewritten paragraph, so the guard survives
	// the prose around them being edited.
	it.each(EXTRA_CLAIM_SURFACES)('%s no longer claims the command exists nowhere', (path) => {
		const content = read_repo_file(path)

		expect(content).not.toContain('exists in neither toolkit yet')
		expect(content).not.toContain('Today that\n> is every consumer')
	})

	// Iterated over `AI_DOCS` rather than reading the one document directly: the rules are
	// single-sourced in `CLAUDE.md` (joshuafolkken/kit#963), and the iteration is the seam a second
	// rule document would slot into without this suite being rewritten.
	it.each(AI_DOCS)('%s tells app-kit and game-kit apart', (document_name) => {
		const document = read_repo_file(document_name)

		expect(document).toContain(APP_KIT_SHIPS)
		expect(document).toContain(GAME_KIT_DOES_NOT)
	})

	// The instruction that outlives any statement about a version. Without it the documents would be
	// correct today and wrong again the day game-kit ships `shot`.
	//
	// Read from the document alone, never through the rule surface. The surface concatenates every
	// distributed skill, and the skill carries this instruction — so a surface read is satisfied by
	// SKILL.md no matter what the document says, and the clause could be dropped from all three
	// documents with the suite still green. That is exactly the resident-text staleness #883 is
	// about, which would make the guard against it vacuous.
	it.each(AI_DOCS)('%s routes the decision to the printed command list', (document_name) => {
		expect(read_repo_file(document_name)).toContain(DECIDE_BY_LIST_DOCUMENT)
	})
})

describe('verify-ui skill screenshot fallback', () => {
	const skill = read_repo_file(SKILL)

	it('still carries the fallback the correction was not meant to remove', () => {
		for (const marker of FALLBACK_MARKERS) {
			expect(skill).toContain(marker)
		}
	})

	// The skill states what shipped where, so it is the file most likely to go stale next. Keeping
	// the override adjacent to the claim is what stops a reader acting on the claim alone.
	it('keeps the version check next to the claim about what ships', () => {
		expect(skill).toContain(DECIDE_BY_LIST_SKILL)
		expect(skill).toContain('the version a project has installed is the only thing that decides')
	})
})

import { describe, expect, it } from 'vitest'
import {
	AI_DOCS,
	read_repo_file,
	read_unwrapped,
	read_unwrapped_rule_surface,
} from './ai-document-fixture'

// joshuafolkken/kit#902: the completion gate's last step used to be a person running
// `pnpm josh test` and pasting the output, which made every `fullrun` / `queue` / `epicrun`
// finish only while somebody was at the keyboard. The reason it was written that way — a 180-second
// CI wait no suite containing E2E could finish in — was removed by joshuafolkken/kit#851, leaving
// the procedure behind. These markers are what stops it coming back one sentence at a time.
const TESTING_GUIDE = 'prompts/testing-guide.md'
const CURSORRULES = '.cursorrules'
const CANONICAL_HEADING = '## 6. Closing the E2E gate without a human run'
const CI_AUTHORITY = 'the CI E2E job is the authority'
// A section `CLAUDE.md` no longer has. Both distributed documents used to send a stuck run to it.
const DANGLING_SECTION = 'Agent / sandbox'
const NO_LONGER_SAYS = 'no longer says %j'

// Phrasings that only ever appear in the retired rule. Asserted against the whole rule surface —
// the document plus every distributed skill — because a run reads the skill and the document as one
// set of instructions, and the human step reinstated in either would be obeyed just the same.
const RETIRED_PHRASINGS: ReadonlyArray<string> = [
	'The user runs `pnpm josh test` and shares the full output',
	'Ask the user to run `pnpm josh test` and share the output',
	'until the user confirms E2E passed',
]

// The trigger half of the resident rule: what an agent must do even if it never opens the pointer.
// Both branches are named, because a rule that says only "do not ask the user" leaves an agent with
// no result to close the gate on.
const RESIDENT_MARKERS: ReadonlyArray<string> = [
	'**Never ask the user to run it, and never wait for their output.**',
	CI_AUTHORITY,
	'`pnpm josh followup --merge` is what enforces it',
	'**you** run `pnpm josh test:e2e` yourself and read what it prints',
	'a skip you did not see printed is not one',
	'`prompts/testing-guide.md` → "Closing the E2E gate without a human run"',
]

describe.each(AI_DOCS)(
	'%s — the completion gate closes E2E without a human run',
	(document_path) => {
		const unwrapped = read_unwrapped(document_path)

		it.each(RESIDENT_MARKERS)('states %j', (marker) => {
			expect(unwrapped).toContain(marker)
		})

		// The numbered step is where the instruction lived. A rule rewritten above while the numbered
		// step still says "ask the user" would read as two rules, and the numbered list is the one a
		// gate run follows top to bottom. The number itself moved when the rule-compliance
		// measurement was inserted ahead of it (joshuafolkken/kit#907), so the marker is the step's
		// text rather than its position.
		it('leaves no human run in the numbered step', () => {
			expect(unwrapped).toMatch(/\d{1,2}\. \*\*E2E\*\* — closed without the user/u)
		})
	},
)

describe.each(AI_DOCS)(
	'%s — the retired human step is gone from the rule surface',
	(document_path) => {
		const surface = read_unwrapped_rule_surface(document_path)

		it.each(RETIRED_PHRASINGS)(NO_LONGER_SAYS, (phrasing) => {
			expect(surface).not.toContain(phrasing)
		})
	},
)

// The pointer has to resolve, and it has to resolve to the procedure rather than to a mention of
// it: an agent that opens the guide must find which result closes the gate, what a project with no
// suite does, and why this is not a relaxation.
describe(`${TESTING_GUIDE} — carries the procedure the gate points at`, () => {
	const content = read_repo_file(TESTING_GUIDE)
	const unwrapped = read_unwrapped(TESTING_GUIDE)

	// The guide is not on the rule surface `read_unwrapped_rule_surface` reads, so its own § 3
	// checklist kept telling an agent to ask the user for a local run — the retired rule, live in the
	// document the new rule points at, behind a green suite.
	it.each(RETIRED_PHRASINGS)(NO_LONGER_SAYS, (phrasing) => {
		expect(unwrapped).not.toContain(phrasing)
	})

	it.each(['ask for local', DANGLING_SECTION])('carries no %j instruction', (phrasing) => {
		expect(unwrapped).not.toContain(phrasing)
	})

	it('holds the heading the completion gate names', () => {
		expect(content).toContain(CANONICAL_HEADING)
	})

	it.each([
		'**Never ask the user to run it, in either row.**',
		'`pnpm josh followup --merge` waits for the checks and refuses to merge',
		'**skips and exits 0**',
		'### The gate is not weakened',
		'A skip you did not see printed is not one',
		'pnpm josh-app verify',
	])('states %j', (marker) => {
		expect(unwrapped).toContain(marker)
	})
})

// The skills describe the same gate step by step, and a run follows their enumeration rather than
// the prose above it. `halfrun` is the case that matters: it opens no pull request, so it is the one
// command whose E2E result nothing else produces.
describe('the workflow skills enumerate the E2E step they now own', () => {
	it.each([
		'.claude/skills/workflow-commands/SKILL.md',
		'.claude/skills/workflow-commands/halfrun.md',
	])('%s names the command that closes it', (skill_path) => {
		expect(read_unwrapped(skill_path)).toContain('`pnpm josh test:e2e`')
	})
})

// `.cursorrules` is distributed too, and it carried the same instruction in its own words. A rule
// removed from one AI document and left standing in another is not removed.
describe(`${CURSORRULES} — the same rule, not the old one`, () => {
	const unwrapped = read_unwrapped(CURSORRULES)

	it.each([
		'never by asking the user to run it',
		CI_AUTHORITY,
		'run **`pnpm josh test:e2e`** yourself',
	])('states %j', (marker) => {
		expect(unwrapped).toContain(marker)
	})

	it('no longer hands the run to the user', () => {
		expect(unwrapped).not.toContain('ask them to run **`pnpm josh test`** locally')
	})

	// The old fallback pointed at an `Agent / sandbox` section that `CLAUDE.md` no longer has, so
	// the escape hatch resolved to nothing.
	it('does not send the reader to a section the rules no longer have', () => {
		expect(unwrapped).not.toContain(DANGLING_SECTION)
	})
})

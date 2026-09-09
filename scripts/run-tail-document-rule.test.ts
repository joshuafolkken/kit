import { read_unwrapped } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1510: a run's idle time collects in its tail, and both ways it collects there are
// invisible after the fact — the transcript shows a command that finished and a turn that ended, not
// the minutes between them. joshuafolkken/kit#1333 settled the merge half once already and it
// regressed, so what is pinned here is that the rule is written down in one place and pointed at from
// the four documents a run actually has open when it reaches the tail.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'
const FOLLOWUP = '.claude/skills/workflow-commands/followup.md'
const EVAL_GATE = '.claude/skills/workflow-commands/eval-gate.md'
const RULE_DELIVERY = 'prompts/collaboration-workflow/rule-delivery.md'
// Shared by the two marker suites, so neither can pass under a title the other does not use.
const CARRIES = 'carries %j'

// The section heading is a marker of its own: every pointer below cites it by number, so a renamed
// section would leave four documents pointing at nothing.
const SECTION = '## 2h. A command that can take minutes is issued in the background'
const SECTION_REFERENCE = '§2h'
const GATE_COMMAND = '`pnpm josh gate`'
const PUSH_COMMAND = '`pnpm josh git -y`'

// **The single source stays single.** A pointer that restated this sentence would be the clone
// `CLAUDE.md` prohibits, in the one place two copies would drift: what may run beside a backgrounded
// command.
const OVERLAP_TEST =
	'**What runs beside a backgrounded command is the work that writes nothing to the working tree.**'

// The body of the rule, in the order §2h states it. Each one is a sentence a reword would soften into
// advice, which is what the two measured symptoms were already ignoring.
const SINGLE_SOURCE_MARKERS: ReadonlyArray<string> = [
	SECTION,
	'**Issue it in the background, and never give a foreground call a timeout above the harness cap.**',
	`**${PUSH_COMMAND} — background.**`,
	'**`pnpm josh followup` — foreground, and that is the boundary rather than an exception.**',
	OVERLAP_TEST,
	'**The turn never ends at the push.**',
	'**so the guarantee is a mechanism and not only the procedure**',
	'This section is the single source of the rule.',
]

// What each pointer document has to carry: the citation, and the half of the rule that binds where
// that document is being read.
const POINTERS: ReadonlyArray<[string, string]> = [
	[
		CHAIN_RULE,
		`**${PUSH_COMMAND} is issued in the background, and the turn does not end when it is**`,
	],
	[CHAIN_RULE, '**Ending the turn at the push is the same violation as ending it at the review**'],
	[FOLLOWUP, `**It is the deliberate exception to \`SKILL.md\` → ${SECTION_REFERENCE}**`],
	[
		EVAL_GATE,
		'A command that can take minutes is issued in the background", applied to one command',
	],
]

const POINTER_DOCUMENTS: ReadonlyArray<string> = [CHAIN_RULE, FOLLOWUP, EVAL_GATE]

describe(`${SKILL} — §2h is the single source`, () => {
	it.each(SINGLE_SOURCE_MARKERS)(CARRIES, (marker) => {
		expect(read_unwrapped(SKILL)).toContain(marker)
	})

	// The three waits a run has, named so the "run something beside it" instruction is actionable
	// rather than an exhortation.
	it.each([GATE_COMMAND, PUSH_COMMAND, 'CI, after the push'])(
		'names %j as a wait with work beside it',
		(wait) => {
			expect(read_unwrapped(SKILL)).toContain(wait)
		},
	)

	// The shared list in §2 is what a run reads before it reaches any single section.
	it('announces the rule in the list every entry point shares', () => {
		const content = read_unwrapped(SKILL)

		expect(content).toContain(
			'**A command that can take minutes is issued in the background, and the turn never ends at the push** — §2h.',
		)
	})
})

describe('the documents open at the tail point at §2h', () => {
	it.each(POINTERS)('%s carries %j', (document_path, marker) => {
		expect(read_unwrapped(document_path)).toContain(marker)
	})

	it.each(POINTER_DOCUMENTS)('%s cites the section by number', (document_path) => {
		expect(read_unwrapped(document_path)).toContain(SECTION_REFERENCE)
	})

	it.each(POINTER_DOCUMENTS)('%s does not restate the body', (document_path) => {
		expect(read_unwrapped(document_path)).not.toContain(OVERLAP_TEST)
	})
})

// The relocation is only real if the rule fires, so the enumeration of delivered rules has to carry a
// row for it — the check joshuafolkken/kit#1524 put in front of every rule that leaves residency.
describe(`${RULE_DELIVERY} — the row and its exemption are written down`, () => {
	it.each([
		`**run 末尾の空転**（\`SKILL.md\` → ${SECTION_REFERENCE}）`,
		PUSH_COMMAND,
		'`run_in_background` が付いていれば引き金に当たらない',
	])(CARRIES, (marker) => {
		expect(read_unwrapped(RULE_DELIVERY)).toContain(marker)
	})
})

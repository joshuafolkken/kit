import {
	AI_DOCS,
	read_unwrapped,
	read_unwrapped_rule_surface,
	RULE_DELIVERY_RATIONALE,
	WORKFLOW_PROMPT_DIRECTORY,
} from '#scripts/document/ai-document-fixture'
import { describe, expect, it } from 'vitest'
import { delivered_rules } from './delivered-rules'
import { piped_verification } from './piped-verification'
import { rule_list } from './rule-list'

// joshuafolkken/kit#1556: a pipeline exits with its last command's status, so `pnpm josh gate | tail`
// answered success on a gate that had printed `✗ verification gate failed`. The failure was real, and
// what caught it was a child reading the output rather than anything the shell reported.
//
// **The rule is delivered, not written down, and this suite is what pins that choice.** Two
// alternatives were measured and rejected — rewriting the procedure documents' examples, when a
// survey of every document, prompt and skill found exactly one piped verification example and it was
// the repository's own explanation of this bug; and stating a calling convention, which
// `scripts/time/time-reported-failure.ts` had already rejected in writing. So what is asserted here is
// that the refusal carries the whole rule, that the reasoning stays at the topic file, and that the
// boundary holds: a read-only listing must never be caught by it.
const TOPIC_FILE = 'output-bounds.md'
const CANONICAL = `${WORKFLOW_PROMPT_DIRECTORY}/${TOPIC_FILE}`
const RATIONALE = 'docs/maintainers/output-bounds-rationale.md'
const SUITE_PATH = 'scripts/rules/piped-verification-rule.test.ts'
// Named once: the enumeration, the topic file and this suite have to agree on the command, and a
// string kept correct in one of three places is not kept.
const GUARD_COMMAND = 'pnpm josh rule:guard'
// The escape hatch that keeps the check's status, asserted on both sides: a refusal that named no way
// to bound the output would leave the caller with the problem that put the pipe there.
const PIPEFAIL = '`set -o pipefail`'
// The anecdote and the rejected alternatives are the quotable half — the first thing that would be
// pasted back into an always-loaded document, and the reason to check that it was not.
const REASONING: ReadonlyArray<string> = [
	'it was caught because the child that ran it read the output',
	'**it is invented fresh every turn**',
]

// Every sentence here changes what the reader does next. Drop the mechanism and the refusal reads as
// a style note; drop the sanctioned way to bound the output and the caller is left with the very
// problem that put the pipe there; drop the boundary and the rule reads as covering every pipe.
describe('the delivered text — what the refusal states', () => {
	const delivered = delivered_rules.PIPED_VERIFICATION_REASON

	it.each([
		"a pipeline exits with its last command's status",
		'Run the check without the pipe',
		'redirect it to a file and read ranges from that file',
		PIPEFAIL,
		'never the exit code alone',
		'Read-only listings are untouched',
	])('carries %j', (marker) => {
		expect(delivered).toContain(marker)
	})

	// A delivery that could not be acted on would wedge the very call it asked for.
	it('tells the reader the call may be reissued', () => {
		expect(delivered).toContain('Reissue this call with no pipe')
	})

	// The pointer is where the reasoning is, and `CLAUDE.md` never carried this rule to point back at.
	it('names the topic file rather than the resident document', () => {
		expect(delivered).toContain(CANONICAL)
		expect(delivered).not.toContain('CLAUDE.md')
	})
})

describe(`${CANONICAL} — the single source for the rule and its rejected alternatives`, () => {
	const content = read_unwrapped(CANONICAL)

	it.each([
		'## 検証コマンドをパイプに繋がない（joshuafolkken/kit#1556）',
		'**パイプラインの終了コードは最後のコマンドのものである。**',
		// The half that keeps the rule from being read as a defect report against `josh gate`.
		'**これは `josh gate` の欠陥ではない。**',
		'**既定はパイプなしで実行する。**',
		PIPEFAIL,
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	// **The boundary is the half that decides whether the hook is worth having.** Narrowing a listing
	// with `| head` is the ordinary way to read one, and a rule wide enough to catch those would fire
	// on the commonest shape in the transcript — which this repository treats as worse than no rule.
	it.each([
		'**`git log | head` や `gh issue list | head` は対象外であり、意図的にそうしている。**',
		'判定ではなく答えを印字する',
	])('states the boundary %j', (marker) => {
		expect(content).toContain(marker)
	})

	// Recorded so the next reader proposes something else rather than re-deriving the same dead end.
	// joshuafolkken/kit#3177 moved the alternatives to the English rationale.
	it.each([
		'**there is no example to rewrite**',
		'**the same idea was already rejected**',
		// Delivery and detection are not alternatives: a hook reaches this harness alone, and the
		// detector is the only path that can measure whether the rule was obeyed.
		'**The detector stays**',
	])('records the rejected alternative %j', (marker) => {
		expect(read_unwrapped(RATIONALE)).toContain(marker)
	})
})

// The reasoning belongs at the pointer, and the resident surface is the likeliest place it would be
// pasted back into.
describe.each(AI_DOCS)('%s — leaves the reasoning at the pointer', (document_path) => {
	it.each(REASONING)('does not carry %j', (marker) => {
		expect(read_unwrapped_rule_surface(document_path)).not.toContain(marker)
		expect(read_unwrapped(RATIONALE)).toContain(marker)
	})
})

describe(`pnpm josh rule:list — the enumeration names this rule and its silent turn`, () => {
	const content = rule_list.render()

	it.each([TOPIC_FILE, GUARD_COMMAND])('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('leaves the pinning suite to the rationale', () => {
		expect(read_unwrapped(RULE_DELIVERY_RATIONALE)).toContain(SUITE_PATH)
	})

	// Every row of that table has to have a non-firing state that means the rule is being kept, or the
	// trigger has not been identified. This one's is that no verification status is being discarded.
	it('says what a turn with no trigger means', () => {
		expect(content).toContain('the exit code reaches the caller')
	})

	// **The trigger set drifts out of the table the moment a command joins it**, and the reader who
	// concludes from the table that `pnpm josh overrides | head` is untouched is refused by the hook
	// instead. Each command is satisfied by its own name or by the glob standing for its family, so a
	// row may stay short — but never silently incomplete.
	it.each([...piped_verification.VERIFICATION_COMMANDS])('names the trigger %j', (command) => {
		const family = command.split(':', 1).join('')

		expect(content.includes(`\`${command}\``) || content.includes(`\`${family}*\``)).toBe(true)
	})
})

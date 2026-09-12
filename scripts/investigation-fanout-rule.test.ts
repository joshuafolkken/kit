import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'

// joshuafolkken/kit#1847: the `setup` phase — run start to first edit — was 30.3% of `fullrun #1839`,
// and three of the run's five longest gaps sat in front of serially launched investigation units, each
// gap the composing of the next brief once the previous unit returned. The three questions were
// independent, so issuing them one at a time was the whole cost; a single fan-out turn collapses the
// three serial thinks to one. The rule is carried in prose because the launches are spread across
// `setup` with reads between them — never the consecutive single-call turns `batch:guard` fires on —
// and the earlier launch falls outside the transcript tail a guard could read.
//
// This is a documentation rule with no trigger that tooling can enforce (recorded the way the chain
// rule records its own). So the test pins that the single source states it and that
// the pointer names the mechanism, rather than exercising a hook.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const POINTER = 'prompts/collaboration-workflow/delegation.md'
const ISSUE = 'joshuafolkken/kit#1847'

// Each marker is a load-bearing half of the rule: the fan-out instruction itself, the independence
// condition that keeps a genuinely serial chain serial, and the recorded reason it is prose rather
// than a `PreToolUse` refusal. Dropping any one inverts the rule — fanning out a dependent chain, or
// re-proposing a guard the tail window cannot support.
const SKILL_MARKERS: ReadonlyArray<string> = [
	'they go out in a single fan-out turn — not one after another',
	'**The three questions needed nothing from one another**',
	'This is the turn-batching principle (§2h) reaching the `Agent`',
	'**The condition is independence, and it is read from the questions rather than assumed.**',
	'**Enforcement was investigated and is not implemented, for the same reason the round-trip batcher misses the pattern.**',
]

describe(`${SKILL} — the single source states the fan-out rule`, () => {
	const content = read_unwrapped(SKILL)

	it.each(SKILL_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})

	it('cites the issue it was filed from', () => {
		expect(content).toContain(ISSUE)
	})
})

describe(`${POINTER} — the pointer names the mechanism without copying the body`, () => {
	const pointer = read_unwrapped(POINTER)

	it('names the fan-out mechanism and cites the issue', () => {
		expect(pointer).toContain('fan-out')
		expect(pointer).toContain(ISSUE)
	})

	// The measured figures are the single source's; a pointer that carried them would be a second copy
	// to keep in sync, which is the clone the delegation rule prohibits.
	it('does not duplicate the measured figures', () => {
		expect(pointer).not.toContain('30.3%')
		expect(pointer).not.toContain('fullrun #1839')
	})
})

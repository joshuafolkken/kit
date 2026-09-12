import { read_unwrapped } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1855: the workflow review is spawned in a subagent (the `Agent` tool), and the
// main line never loads `/code-review` through the `Skill` tool. Loading a skill mid-run swaps the
// active skill's instructions into the leading text of the prompt, which sits in front of the whole
// cached conversation — so the load rewrites the entire cached prefix rather than appending to it
// (~303,637 tokens on `fullrun #1839`). Moving the launch of the review fork onto the `Agent` tool,
// which is already in the main line's tool set, appends rather than rewrites.
//
// The rule is prose, so it rots the way prose does: a reword drops the mechanism, or a flow document
// quietly goes back to naming the main-line `/code-review` invocation. Each marker below is one of
// those loss points.

const SINGLE_SOURCE = 'prompts/review.md'
const CHAIN_RULE = '.claude/skills/workflow-commands/chain-rule.md'

// Every flow document whose review step must route through a subagent rather than a main-line skill
// load. The same set `review-level-document-rule.test.ts` guards for the level, minus the pointer
// files that carry no invocation of their own.
const FLOW_DOCUMENTS: ReadonlyArray<string> = [
	'.claude/skills/workflow-commands/SKILL.md',
	CHAIN_RULE,
	'.claude/skills/workflow-commands/fullrun.md',
	'.claude/skills/workflow-commands/halfrun.md',
	'.claude/skills/workflow-commands/queue.md',
]

// The rule, in its single source. Each is a part a reword most easily loses: the mechanism (leading
// text, whole prefix), the measurement that makes it concrete, and the guard against reading it as
// the cheaper-tier delegation §2b refuses.
const SINGLE_SOURCE_MARKERS: ReadonlyArray<string> = [
	'The review runs in a subagent, never a main-line skill load',
	'the review is spawned in a subagent',
	'the main line never loads `/code-review` through the `Skill` tool',
	"swaps the active skill's instructions into the leading text of the prompt",
	'rewrites the entire cached prefix rather than appending to it',
	'303,637',
	'joshuafolkken/kit#1855',
	// Not the cheaper-tier downgrade §2b keeps the review out of: same model, so quality is untouched.
	'the subagent inherits the main-loop model',
]

describe(`${SINGLE_SOURCE} — the single source states the subagent rule`, () => {
	const content = read_unwrapped(SINGLE_SOURCE)

	it.each(SINGLE_SOURCE_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The chain rule is the single source of "the review output is not a turn boundary", so it has to
// say the output it means is now the subagent's returned findings — and point at the mechanism's
// single source rather than restating it.
describe(`${CHAIN_RULE} — routes the review through a subagent`, () => {
	const content = read_unwrapped(CHAIN_RULE)

	it('states the review is spawned in a subagent', () => {
		expect(content).toContain(
			'The review is spawned in a subagent, and the main line never loads the skill',
		)
	})

	it('names the `Agent` tool as how the fork is launched', () => {
		expect(content).toContain('Run `/code-review` through the `Agent` tool')
	})

	it('cites the single source rather than restating the mechanism', () => {
		expect(content).toContain(SINGLE_SOURCE)
	})
})

// The rule is only real if the flow documents' review steps actually route through a subagent. A
// step that reverted to the bare main-line invocation is the regression this pins.
describe.each(FLOW_DOCUMENTS)('%s — runs the review in a subagent', (document_path) => {
	const content = read_unwrapped(document_path)

	it('runs `/code-review` in a subagent', () => {
		expect(content).toContain('a subagent running `/code-review`')
	})
})

// The resident completion gate reaches the review on turns the flow documents do not, so it carries
// the same instruction — spawn the subagent, never load the skill in the main line.
describe('CLAUDE.md — the completion gate spawns the review in a subagent', () => {
	const content = read_unwrapped('CLAUDE.md')

	it('spawns a subagent to run `/code-review`', () => {
		expect(content).toContain('spawn a subagent to run `/code-review')
	})
})

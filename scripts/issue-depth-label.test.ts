import {
	DEPTH_0_LABEL,
	DEPTH_1_LABEL,
	DEPTH_2_LABEL,
	DEPTH_LABEL_ORDER,
	DEPTH_LABELS,
	EPIC_LABEL,
	INTERRUPT_ROUTE_LABEL,
	TIER_A_ROUTE_LABEL,
} from '#scripts/git/issue-labels'
import { ALIASES, COMMAND_MAP } from '#scripts/josh/josh-command-map'
import { describe, expect, it } from 'vitest'
import { read_repo_file } from './ai-document-fixture'

// joshuafolkken/kit#1729: joshuafolkken/kit#1698 set the depth-0 share of the open backlog as a
// measurable target and shipped nothing that records a depth, so the number could only be produced
// by reading every open Issue by eye — and two such counts a day apart took different denominators.
// This suite pins the three halves of the repair to each other: the labels that record a depth, the
// documented instruction to apply one at filing time, and the command that reads the share back.
const WORKFLOW_SKILL = '.claude/skills/workflow-commands/SKILL.md'
const COMMAND_DOC = 'docs/josh-commands.md'
const LABEL_MODULE = 'scripts/git/issue-labels.ts'
const SHARE_MODULE = 'scripts/issue/issue-depth-share.ts'
const COMMAND_NAME = 'depth:share'
const COMMAND_ALIAS = 'dsh'
const DEPTH_LABEL_COUNT = 3
// The placeholder spelling every filing template carries — the depth itself varies per Issue, so the
// template names the flag and §2i names how to choose the number.
const FILING_FLAG = "-f 'labels[]=depth:<n>'"

// Prettier reflows prose, so a marker that spans a line break would fail on formatting alone. Every
// prose assertion below runs against the collapsed copy; the code-fence markers keep their raw form,
// because a fenced line is never reflowed and its exact spelling is what a reader copies.
function unwrapped(path: string): string {
	return read_repo_file(path).replaceAll(/\s+/gu, ' ')
}

function label_flag(label: string): string {
	return `-f 'labels[]=${label}'`
}

describe('the depth labels', () => {
	it.each([DEPTH_0_LABEL, DEPTH_1_LABEL, DEPTH_2_LABEL])(
		'defines %s in the label module',
		(label) => {
			expect(read_repo_file(LABEL_MODULE)).toContain(`= '${label}'`)
		},
	)

	it('orders them shallowest first, which is the tie-break', () => {
		expect(DEPTH_LABEL_ORDER).toStrictEqual([DEPTH_0_LABEL, DEPTH_1_LABEL, DEPTH_2_LABEL])
	})

	it('provisions all three with a color and a description', () => {
		expect(DEPTH_LABELS).toHaveLength(DEPTH_LABEL_COUNT)
		expect(DEPTH_LABELS.map((label) => label.name)).toStrictEqual([...DEPTH_LABEL_ORDER])
	})

	// The depth table is §2i's, and a description that paraphrased it would be a second copy of the
	// rule — so each one names the section instead.
	it.each(DEPTH_LABELS)('points $name at the section that defines it', (label) => {
		expect(label.description).toContain('SKILL.md §2i')
	})

	// Metadata nothing provisions is metadata a repository never sees: the first filing that applies
	// the label auto-creates it with a generated color and no description, and the array below would
	// go on asserting a color nobody had ever set. Prose cannot import this module, so the document's
	// creation lines are keyed to it here instead.
	it.each(DEPTH_LABELS)('is provisioned with $name’s own color and description', (label) => {
		const skill = read_repo_file(WORKFLOW_SKILL)

		expect(skill).toContain(`-f name=${label.name} -f color=${label.color}`)
		expect(skill).toContain(`-f description="${label.description}"`)
	})
})

describe('the filing-time rule in SKILL.md §2i', () => {
	const skill = unwrapped(WORKFLOW_SKILL)

	it.each([
		'The depth is recorded on the Issue as a label, and the label is applied when the Issue is filed',
		'the table above is the single source',
		'**Every filing route applies one**',
		'It is read off the subject, exactly as the table is',
		'**Applied at filing, not at completion.**',
		'counts as the lowest depth present',
	])('states: %j', (marker) => {
		expect(skill).toContain(marker.replaceAll(/\s+/gu, ' '))
	})

	it.each([DEPTH_1_LABEL])('shows the filing flag for %s', (label) => {
		expect(read_repo_file(WORKFLOW_SKILL)).toContain(label_flag(label))
	})

	// **The rule in §2i is not enough on its own**: a run copies the `gh api … issues` line out of the
	// entry point's own file, so a template without the flag files without the label and the share
	// reports everything as `unlabelled`. Each document below carries a filing command of its own, and
	// each is keyed here to the flag. An epic-creating template is deliberately absent — an epic takes
	// no depth label, because it has no subject of its own to read one off.
	it.each([
		'.claude/skills/workflow-commands/kickoff.md',
		'.claude/skills/workflow-commands/fullrun.md',
		'.claude/skills/workflow-commands/halfrun.md',
		WORKFLOW_SKILL,
		'prompts/review.md',
		'prompts/collaboration-workflow/wip-cap.md',
	])('is carried by the filing command in %s', (path) => {
		expect(read_repo_file(path)).toContain(FILING_FLAG)
	})
})

describe('the denominator', () => {
	const skill = unwrapped(WORKFLOW_SKILL)

	it.each([
		'Counted: every open Issue that does not carry `epic`',
		'An Issue with no depth label is in the denominator',
		'The numerator is what is left',
		'Two readings of the same backlog give the same number',
	])('is documented: %j', (marker) => {
		expect(skill).toContain(marker.replaceAll(/\s+/gu, ' '))
	})

	it.each([EPIC_LABEL, TIER_A_ROUTE_LABEL, INTERRUPT_ROUTE_LABEL])(
		'says how %s is treated',
		(label) => {
			expect(skill).toContain(`\`${label}\``)
		},
	)

	// The module implements the rule and must not restate it — a paraphrase in a comment is the clone
	// `CLAUDE.md` prohibits, and pinning that paraphrase with a marker would make the clone permanent.
	// So what is asserted is that the module points at the section instead.
	it('is pointed at from the module that implements it, never paraphrased there', () => {
		expect(read_repo_file(SHARE_MODULE)).toContain('The denominator rule is not restated here')
		expect(read_repo_file(SHARE_MODULE)).toContain(WORKFLOW_SKILL)
	})
})

describe('the command that reads the share', () => {
	it('is registered', () => {
		expect(Object.keys(COMMAND_MAP)).toContain(COMMAND_NAME)
	})

	it('carries its alias', () => {
		expect(ALIASES[COMMAND_ALIAS]).toBe(COMMAND_NAME)
	})

	it.each([WORKFLOW_SKILL, COMMAND_DOC])('is documented in %s', (path) => {
		expect(read_repo_file(path)).toContain(`pnpm josh ${COMMAND_NAME}`)
	})

	it('names the alias in the command reference', () => {
		expect(read_repo_file(COMMAND_DOC)).toContain(`alias: josh ${COMMAND_ALIAS}`)
	})

	it('never answers a failed fetch with a share', () => {
		expect(unwrapped(COMMAND_DOC)).toContain('**Never a share of zero**')
	})
})

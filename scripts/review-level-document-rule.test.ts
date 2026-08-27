import { AI_DOCS, read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { review_level } from '#scripts/review/review-level'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#966: the review level is decided by a command, not by judgement. Two things can
// rot independently — the documents can stop naming the command, and the inert set they print can
// drift from the one the command actually uses. A reader following a stale list would apply a rule
// the tool does not.

const REVIEW_PROMPT = 'prompts/review.md'
const COMMAND = 'pnpm josh review:level'
const COMMAND_DOC = 'docs/josh-commands.md'
const INERT_DOCUMENTS: ReadonlyArray<string> = [...AI_DOCS, REVIEW_PROMPT, COMMAND_DOC]

// Every file that tells a run which level to review at. The first version of this suite read only
// `CLAUDE.md` and `prompts/review.md`, so the rule could be — and was — documented in two places
// while every procedure a run actually follows still typed `medium` (joshuafolkken/kit#966).
const FLOW_DOCUMENTS: ReadonlyArray<string> = [
	'.claude/skills/workflow-commands/SKILL.md',
	'.claude/skills/workflow-commands/chain-rule.md',
	'.claude/skills/workflow-commands/fullrun.md',
	'.claude/skills/workflow-commands/halfrun.md',
	'.claude/skills/workflow-commands/queue.md',
	'prompts/collaboration-workflow/plan-comment.md',
]

// The same string as COMMAND: what a flow document must contain is the command itself, not a
// particular sentence around it — the sentence was rewritten once already for a rendering bug.
const ROUTED_FORM = COMMAND

describe('the review level is routed to the command', () => {
	it.each([...AI_DOCS, REVIEW_PROMPT])('%s names the command', (document_path) => {
		expect(read_repo_file(document_path)).toContain(COMMAND)
	})

	it.each([...AI_DOCS, REVIEW_PROMPT])('%s says the level is not a judgement', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('never by judgement')
	})
})

// The list in the prose has to be *the same list* as the one in the code — not merely a list whose
// entries the code happens to agree with. The first version of this guard asked "does the command
// reject every path this document mentions?", which a document mentioning `.vscode/**` in order to
// say it is *not* inert satisfies just as well as one claiming it *is*. It passed while CLAUDE.md
// and prompts/review.md both listed three shipped paths as inert (joshuafolkken/kit#966).
const TABLE_MARKER = '**inert** —'
const PROSE_MARKER = 'is inert ('
const INERT_LINE_MARKERS: ReadonlyArray<string> = [TABLE_MARKER, PROSE_MARKER]
const CODE_SPAN = /`([^`]+)`/gu

function inert_line(content: string): string {
	const line = content
		.split('\n')
		.find((candidate) => INERT_LINE_MARKERS.some((marker) => candidate.includes(marker)))

	return line ?? ''
}

// Only the list itself: the table cell up to its closing pipe, or the parenthesis in the prose
// form. Taking the whole line swept up the `low` / `medium` / `1` cells beside it.
function inert_scope(line: string): string {
	const prose = line.indexOf(PROSE_MARKER)

	if (prose !== -1) {
		const open = line.indexOf('(', prose)

		return line.slice(open + 1, line.indexOf(')', open))
	}

	const marker = line.indexOf(TABLE_MARKER)
	const cell = line.slice(marker)

	return cell.slice(0, cell.indexOf('|'))
}

function listed_inert_paths(document_path: string): Array<string> {
	const scope = inert_scope(inert_line(read_repo_file(document_path)))
	const listed: Array<string> = []

	for (const match of scope.matchAll(CODE_SPAN)) {
		if (match[1] !== undefined) listed.push(match[1])
	}

	return listed.toSorted((left, right) => left.localeCompare(right))
}

function code_inert_paths(): Array<string> {
	return [
		...review_level.INERT_PATHS,
		...review_level.INERT_PREFIXES.map((prefix) => `${prefix}**`),
		...review_level.INERT_SUFFIXES.map((suffix) => `*${suffix}`),
	].toSorted((left, right) => left.localeCompare(right))
}

describe('the documented inert set is the one the command uses', () => {
	it.each(INERT_DOCUMENTS)('%s states an inert list at all', (document_path) => {
		expect(listed_inert_paths(document_path).length).toBeGreaterThan(0)
	})

	it.each(INERT_DOCUMENTS)('%s lists exactly what the command treats as inert', (document_path) => {
		expect(listed_inert_paths(document_path)).toStrictEqual(code_inert_paths())
	})
})

describe('documentation is stated as not inert', () => {
	it.each([...AI_DOCS, REVIEW_PROMPT])(
		'%s says documentation stays at the default level',
		(document_path) => {
			expect(read_unwrapped(document_path)).toContain('documentation')
		},
	)

	// The evidence, not just the claim: a reader who disagrees needs to be able to check it.
	it('the review prompt cites the measurement the rule rests on', () => {
		const content = read_unwrapped(REVIEW_PROMPT)

		expect(content).toContain('joshuafolkken/kit#963')
		expect(content).toContain('ten real defects in each')
	})
})

// The rule is only real if the procedures use it.
describe.each(FLOW_DOCUMENTS)('%s — reviews at the level the command decides', (document_path) => {
	const content = read_repo_file(document_path)

	it('routes to the command instead of typing a level', () => {
		expect(content).toContain(ROUTED_FORM)
	})

	it('types no fixed level of its own', () => {
		expect(content).not.toContain('/code-review medium')
		expect(content).not.toContain('/code-review low')
	})

	// Markdown cannot express a code span inside a code span; the first attempt at the routed form
	// nested them and rendered as two spans with bare text between (joshuafolkken/kit#966).
	it('nests no code span inside another', () => {
		expect(content).not.toContain('`/code-review <the level `')
	})
})

describe('the round cap is untouched', () => {
	it.each([...AI_DOCS, REVIEW_PROMPT])('%s still caps the rounds at two', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('two')
	})

	it('the review prompt still says a confirmed High blocks regardless of round count', () => {
		expect(read_unwrapped(REVIEW_PROMPT)).toContain(
			'confirmed High blocks regardless of round count',
		)
	})
})

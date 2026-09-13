import { AI_DOCS, read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { review_level } from '#scripts/review/review-level'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#966: the review level is decided by a command, not by judgement. Two things can
// rot independently — the documents can stop naming the command, and the inert set they print can
// drift from the one the command actually uses. A reader following a stale list would apply a rule
// the tool does not.

const REVIEW_PROMPT = 'prompts/review.md'
// joshuafolkken/kit#1927 retired the standalone `review:level` command and folded the level into
// `review:brief --level-only`, so the documents now name that spelling. The rule is unchanged: the
// level comes from a command, never from a typed judgement.
const COMMAND = 'pnpm josh review:brief --level-only'
const COMMAND_DOC = 'docs/josh-commands.md'
// joshuafolkken/kit#1924 slimmed `CLAUDE.md` to the resident review-level trigger — it names the
// command and caps the rounds at two, while the inert enumeration, the "never by judgement" phrasing
// and "documentation is not inert" moved to `prompts/review.md` and `docs/josh-commands.md`, which
// still carry and pin them. So the detailed set is asserted at those two, not resident.
const INERT_DOCUMENTS: ReadonlyArray<string> = [REVIEW_PROMPT, COMMAND_DOC]

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

// The command itself, not a particular sentence around it — the sentence was rewritten once already
// for a rendering bug. **Two spellings satisfy the rule since joshuafolkken/kit#1241**: the workflow
// entry points now name `review:brief`, which prints the level on its first line by reusing
// `review_level` rather than deciding again, while the resident documents keep naming the level
// command for a pre-commit review run outside any workflow. What the rule is about — the level comes
// from a command and never from a typed judgement — is unchanged by which of the two a file names.
const BRIEF_COMMAND = 'pnpm josh review:brief'
const ROUTED_FORMS: ReadonlyArray<string> = [COMMAND, BRIEF_COMMAND]

describe('the review level is routed to the command', () => {
	it.each([...AI_DOCS, REVIEW_PROMPT])('%s names the command', (document_path) => {
		expect(read_repo_file(document_path)).toContain(COMMAND)
	})

	// The "never by judgement" phrasing is `prompts/review.md`'s; `CLAUDE.md` carries the mechanical
	// rule as its resident trigger (the level comes from the command) rather than this sentence
	// (joshuafolkken/kit#1924).
	it.each([REVIEW_PROMPT])('%s says the level is not a judgement', (document_path) => {
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
	// `CLAUDE.md` no longer restates "documentation is not inert" — that consequence lives at
	// `prompts/review.md` with its measurement (joshuafolkken/kit#1924).
	it.each([REVIEW_PROMPT])('%s says documentation stays at the default level', (document_path) => {
		expect(read_unwrapped(document_path)).toContain('documentation')
	})

	// The evidence, not just the claim: a reader who disagrees needs to be able to check it.
	it('the review prompt cites the measurement the rule rests on', () => {
		const content = read_unwrapped(REVIEW_PROMPT)

		expect(content).toContain('joshuafolkken/kit#963')
		expect(content).toContain('ten real defects in each')
	})
})

// The rule is only real if the procedures use it. joshuafolkken/kit#1925 deduplicates the
// gate → review → merge narrative into one canonical home and turns the others into references, so the
// positive is aggregated — the command is routed somewhere in the flow — while the negatives that
// caught joshuafolkken/kit#966 (a procedure typing a fixed level of its own) stay per document, since
// a referencing doc must not type a level either.
describe('the review flow routes to the command, never a typed level', () => {
	it('names the level command in at least one flow document', () => {
		const is_routed = FLOW_DOCUMENTS.some((document_path) => {
			const content = read_repo_file(document_path)

			return ROUTED_FORMS.some((form) => content.includes(form))
		})

		expect(is_routed).toBe(true)
	})

	it.each(FLOW_DOCUMENTS)('%s types no fixed level of its own', (document_path) => {
		const content = read_repo_file(document_path)

		expect(content).not.toContain('/code-review medium')
		expect(content).not.toContain('/code-review low')
	})

	// Markdown cannot express a code span inside a code span; the first attempt at the routed form
	// nested them and rendered as two spans with bare text between (joshuafolkken/kit#966).
	it.each(FLOW_DOCUMENTS)('%s nests no code span inside another', (document_path) => {
		expect(read_repo_file(document_path)).not.toContain('`/code-review <the level `')
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

import { read_repo_file, read_unwrapped, routing_documents } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#1204. `pnpm josh followup` merges unless it is told not to — the workflow
// resolves it as `values['no-merge'] !== true`, so passing nothing merges — and `--merge` is a
// deprecated no-op kept only for compatibility. Every distributed document wrote the merging step as
// `pnpm josh followup --merge` anyway, which reads as the switch that starts a merge. Under that
// reading "I did not pass the flag, so nothing merged" is a safe-looking conclusion that is exactly
// backwards, and merging is Tier C: an irreversible change to shared state.
//
// The same misreading produced the second half of the defect. `completion-notify.md` labelled an
// example "no merge (after a `kickoff`)" and gave it no `--no-merge` — a working merge command
// standing under a heading that said it was not one, aimed at the one situation where the merge is
// not authorized at all.
//
// The decision recorded on the Issue is to leave the implementation alone and correct the documents:
// merging is the default, `--no-merge` is the only thing that stops it, and no document writes the
// deprecated flag. `followup-document-rule.test.ts` pins that sentence in the single source. This
// suite pins the two properties that have to hold across *every* document, because the defect was
// never one file — a correction applied to the procedure alone is what left the rest of the
// distribution saying the opposite.
const CURSOR_RULES = '.cursorrules'

// Enumerated from disk rather than listed here: a hardcoded list is what let a document drift out of
// a scan before (joshuafolkken/kit#873). `.cursorrules` is appended because it is a distributed
// agent document that `routing_documents` does not walk — it is not markdown and not under a root.
const DOCUMENTS: ReadonlyArray<string> = [...routing_documents(), CURSOR_RULES]

const FOLLOWUP_SKILL = '.claude/skills/workflow-commands/followup.md'
const FOLLOWUP_CALL = 'josh followup'

const BANNED_FLAG = '--merge'
// **Not an adjacency check.** A runnable example puts the quoted `"<title> #<N>"` positional and a
// `\` line continuation between the command word and the flag, so a scan for the two side by side
// passes on the exact form every example in the distribution was written in — which is the form the
// Issue is about. What the command word reaches is a window, not the next token.
//
// Wide enough for a positional, a continuation and a flag; narrow enough that the next sentence's
// mention of the deprecated flag is not read as part of a command.
const COMMAND_WINDOW = 120

// Splitting on the flag never lands inside `--no-merge`, which does not contain `--merge`, so the
// one flag that is supposed to be there cannot be mistaken for the one that must not.
function flagged_invocations(content: string): ReadonlyArray<string> {
	const parts = content.split(BANNED_FLAG)

	return parts
		.slice(0, -1)
		.map((part) => part.slice(-COMMAND_WINDOW))
		.filter((prefix) => prefix.includes(FOLLOWUP_CALL))
}

// Read unwrapped, so a spelling broken across a line wrap is caught too — which is how `epicrun.md`
// carried it, with `pnpm josh followup` ending one line and `--merge` opening the next.
describe('no distributed document passes the deprecated flag to `josh followup`', () => {
	it.each(DOCUMENTS)('%s never writes the flag beside the command', (path) => {
		expect(flagged_invocations(read_unwrapped(path))).toEqual([])
	})

	// The negative control, and the reason `COMMAND_WINDOW` exists. The first version of this suite
	// compared the command word with the token after it and stayed green with `--merge` restored to
	// all three `followup.md` examples — a guard that passed on the regression it was written for.
	it('detects the runnable-example form the distribution actually used', () => {
		const example = String.raw`pnpm josh followup "<t> #<N>" \ --merge \ --notify-message`

		expect(flagged_invocations(example)).toHaveLength(1)
	})
})

const FENCE = '```'
const STOP_FLAG = '--no-merge'
// A block's label is the paragraph that introduces it, not everything since the previous block. Read
// wider and the options table two sections up decides what an example claims; read a fixed number of
// characters back and a long introduction pushes its own heading out of range, which is what the
// positive control below caught on the first attempt.
const PARAGRAPH_BREAK = /\n\s*\n/u
const CODE_SEGMENT = 2
const NO_MERGE_LABEL = /no merge|without merging|do not merge|マージしない|マージなし/iu

interface Example {
	readonly label: string
	readonly body: string
}

function last_paragraph(prose: string): string {
	const paragraphs = prose.split(PARAGRAPH_BREAK).filter((part) => part.trim().length > 0)

	return paragraphs.at(-1) ?? ''
}

// Splitting markdown on the fence alternates prose and code, so an odd index is a fenced block and
// the segment before it is the prose that introduces it.
function followup_examples(content: string): ReadonlyArray<Example> {
	const segments = content.split(FENCE)
	const labelled = segments.map((body, index) => ({
		body,
		index,
		label: last_paragraph(segments[index - 1] ?? ''),
	}))

	return labelled.filter(
		(entry) => entry.index % CODE_SEGMENT === 1 && entry.body.includes(FOLLOWUP_CALL),
	)
}

function unstopped_no_merge_examples(path: string): ReadonlyArray<string> {
	return followup_examples(read_repo_file(path))
		.filter((example) => NO_MERGE_LABEL.test(example.label))
		.filter((example) => !example.body.includes(STOP_FLAG))
		.map((example) => example.body)
}

describe('an example that says it does not merge carries the flag that stops the merge', () => {
	it.each(DOCUMENTS)('%s leaves no such example unstopped', (path) => {
		expect(unstopped_no_merge_examples(path)).toEqual([])
	})

	// The positive control. Without it the scan above passes on a repository where the label pattern
	// matches nothing at all — a green suite asserting the absence of a thing it cannot detect, which
	// is the failure mode the whole check exists to remove.
	it('finds the one example the skill labels as not merging', () => {
		const examples = followup_examples(read_repo_file(FOLLOWUP_SKILL))
		const labelled = examples.filter((example) => NO_MERGE_LABEL.test(example.label))

		expect(labelled).toHaveLength(1)
		expect(labelled[0]?.body).toContain(STOP_FLAG)
	})
})

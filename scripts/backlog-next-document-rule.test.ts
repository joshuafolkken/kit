import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'
import { COMMAND_MAP } from './josh/josh-command-map'

// joshuafolkken/kit#1630: `backlog:next` is the one route that answers what the whole opted-in
// backlog may run next, and three of its decisions are sentences somebody could reword away — that
// an epic root's `auto-ok` stands for its children, that the graph and the wave are `epic:next`'s
// rather than a second copy, and that standard output carries tokens while everything else goes to
// standard error. A document that keeps the command and drops any one of them describes a command
// that either asks for a per-child label nobody applies, drifts from what `epic:next` means by the
// same word, or cannot be read by the loop it exists for.
//
// The entry point that consumes this answer is filed separately, so the skill does not describe the
// command yet; the command's own document is the surface the rule lives on until it does.

const COMMAND_DOC = 'docs/josh-commands.md'
const COMMAND_NAME = 'backlog:next'
const COMMAND = `pnpm josh ${COMMAND_NAME}`

describe('the command is reachable from the document that names it', () => {
	it('registers the command so the document can name it', () => {
		expect(Object.keys(COMMAND_MAP)).toContain(COMMAND_NAME)
	})

	it('routes the answer through the command rather than a hand-written listing', () => {
		expect(read_unwrapped(COMMAND_DOC)).toContain(COMMAND)
	})
})

// Each marker is the load-bearing sentence of one decision, with the failure it prevents beside it.
const DECISION_MARKERS: ReadonlyArray<[string, string]> = [
	// Without this, a per-child label is asked for again, and a forgotten one is a hole in the graph.
	['the epic root stands for its children', "**An epic root's `auto-ok` stands for every child.**"],
	// Without this, the next reader builds a second graph, and the two disagree about `wait`.
	[
		'the graph and the wave stay single-sourced',
		'**Nothing here re-implements the graph or the wave.**',
	],
	// Without this, prose creeps onto standard output and `answer=$(…)` stops parsing.
	['the output contract', 'Standard output carries one token per line'],
	// Without this, `none` and `complete` read as different answers to the same question.
	['none is complete under another spelling', "`none` is `epic:next`'s `complete`"],
	// Without this, an issue that just merged is left in a bucket and answers `wait` for an empty backlog.
	[
		'the exclusion clears every bucket',
		'drops them from **every** bucket rather than only from the offer',
	],
	// Without this, an unlabelled epic reads as a limitation nobody wrote down, and `epic:audit` is not reached.
	[
		'the epic label is how epics are found',
		'An epic that never received that label is invisible here too',
	],
]

describe('the document keeps every decision the command rests on', () => {
	it.each(DECISION_MARKERS)('says %s', (_name, marker) => {
		expect(read_unwrapped(COMMAND_DOC)).toContain(marker)
	})
})

// The candidate table is the acceptance criteria in one place: the two sources, and the rule that a
// child's own label neither adds it nor makes it standalone while its epic is the one offering it.
// joshuafolkken/kit#1668 is where the exclusion narrowed to the opted-in epics, and the marker says
// so — the bare "no epic tracks it" is the sentence that made a person's label silently inert.
describe('the candidate table', () => {
	it('names the standalone source and its epic exclusion', () => {
		expect(read_unwrapped(COMMAND_DOC)).toContain(
			'It carries `auto-ok`, and no **opted-in** epic tracks it',
		)
	})

	it('names the epic source and refuses to require a child label', () => {
		const text = read_unwrapped(COMMAND_DOC)

		expect(text).toContain("**The epic's root carries `auto-ok`.**")
		expect(text).toContain('carrying one does not make it a standalone candidate')
	})
})

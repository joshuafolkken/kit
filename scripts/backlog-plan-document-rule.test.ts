import { describe, expect, it } from 'vitest'
import { read_unwrapped } from './ai-document-fixture'
import { COMMAND_MAP } from './josh/josh-command-map'

/*
 * joshuafolkken/kit#1652: `backlog:plan` is the plan a person reads before a `backlogrun` starts.
 * Four of its decisions are sentences somebody could reword away, and each one changes what the
 * command is for:
 *
 * 1. It renders `backlog:next`'s classification rather than deriving a second one. Lose this and the
 *    plan and the run can disagree about what may start, which is worse than having no plan.
 * 2. The per-repository grouping is the parallelism, because a lane is per repository. Read as
 *    formatting, it gets flattened and the run's width stops being visible.
 * 3. The out-of-scope half is a subtraction. Written as its own membership test, it drifts from the
 *    pool and starts claiming issues are excluded that the backlog would in fact run.
 * 4. A failed open listing is reported. Rendered around, an empty out-of-scope section is a confident
 *    absence built on a read that failed — joshuafolkken/kit#950's rule exactly.
 */

const COMMAND_DOC = 'docs/josh-commands.md'
const ENTRY_SKILL = '.claude/skills/workflow-commands/backlogrun.md'
const COMMAND_NAME = 'backlog:plan'
const COMMAND = `pnpm josh ${COMMAND_NAME}`
const ALIAS = 'blp'

describe('the command is reachable from the document that names it', () => {
	it('registers the command so the document can name it', () => {
		expect(Object.keys(COMMAND_MAP)).toContain(COMMAND_NAME)
	})

	it('gives the command an alias the document can print', () => {
		expect(read_unwrapped(COMMAND_DOC)).toContain(`# alias: josh ${ALIAS}`)
	})

	it('documents the command rather than leaving it to be found in the map', () => {
		expect(read_unwrapped(COMMAND_DOC)).toContain(COMMAND)
	})
})

// Each marker is the load-bearing sentence of one decision, with the failure it prevents beside it.
const DECISION_MARKERS: ReadonlyArray<[string, string]> = [
	// Without this, a second classification is written and the plan can contradict the run.
	[
		'the classification stays single-sourced',
		'**The plan cannot promise an order the run does not take.**',
	],
	// Without this, the per-repository bundles are flattened and the run's width stops being visible.
	['the grouping is the parallelism', '**The grouping is the parallelism, not a presentational'],
	// Without this, the dependency edges go back to being read but never shown.
	['a waiting row names its blocker', '**"Waiting" names the blocker.**'],
	// Without this, out-of-scope becomes a second membership rule that drifts from the pool.
	['out of scope is a subtraction', '**"Out of scope" is a subtraction, never a second membership'],
	// Without this, an unreadable listing renders as "nothing is out of scope".
	[
		'a failed read is reported rather than rendered around',
		'**A failed read of the open listing is reported, not rendered around.**',
	],
]

describe(`${COMMAND_DOC} — keeps the decisions that make the command what it is`, () => {
	const document = read_unwrapped(COMMAND_DOC)

	it.each(DECISION_MARKERS)('records %s', (_name, marker) => {
		expect(document).toContain(marker)
	})
})

describe(`${COMMAND_DOC} — points at the entry point that consumes the plan`, () => {
	const document = read_unwrapped(COMMAND_DOC)

	it('names the keyword and the file carrying its procedure', () => {
		expect(document).toContain('**The entry point that consumes this is `backlogrun`**')
		expect(document).toContain(ENTRY_SKILL)
	})
})

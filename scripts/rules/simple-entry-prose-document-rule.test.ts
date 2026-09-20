import { read_repo_file, routing_documents } from '#scripts/document/ai-document-fixture'
import { single_source, type SingleSourceRule } from '#scripts/document/single-source'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2189. The simple workflow entries (`kickoff` / `fullrun` / `halfrun` and the
// dispatched lane child) were trimmed to a manifest: each detailed prose body left `SKILL.md` and the
// command files for a reference-only companion document, leaving a terse trigger-plus-pointer stub in
// its place. This suite is the hold on that move — for each relocated body it asserts the body lives in
// exactly one document, so the reduction cannot be undone by pasting the prose back into `SKILL.md` or
// a command manifest. It runs the `single-source.ts` framework #2188 shipped against the real corpus.

const SKILL_DIR = '.claude/skills/workflow-commands'

// Each rule names a phrase unique to a relocated body and the one document allowed to carry it. The
// phrase is verbatim from the body, so a copy pasted back anywhere in the routing corpus fails the
// assertion — which is the reduction's guarantee.
const RELOCATED_BODIES: ReadonlyArray<SingleSourceRule> = [
	{
		marker: 'Stopping is the specification, not a failure',
		canonical: `${SKILL_DIR}/needs-human-review.md`,
	},
	{
		marker:
			'one branch, one index and one uncommitted diff, and a linked work tree has its own three',
		canonical: `${SKILL_DIR}/working-tree-hold.md`,
	},
	{
		marker: 'writes its agreements into comments and then reads only bodies',
		canonical: `${SKILL_DIR}/issue-comments.md`,
	},
	{
		marker: 'The work in progress almost always includes a',
		canonical: `${SKILL_DIR}/prerequisite.md`,
	},
	{
		marker: 'The release ask — the last step of either form',
		canonical: `${SKILL_DIR}/fullrun-steps.md`,
	},
]

describe('the relocated simple-entry prose is single-sourced to its companion document', () => {
	const documents = routing_documents()

	it.each(RELOCATED_BODIES)('holds $canonical as the one home of its body', (rule) => {
		expect(single_source.is_single_sourced(rule, documents, read_repo_file)).toBe(true)
	})

	it.each(RELOCATED_BODIES)('reports no other carrier of $canonical', (rule) => {
		expect(single_source.violations(rule, documents, read_repo_file)).toStrictEqual([])
	})
})

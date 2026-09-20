import { read_repo_file, routing_documents } from '#scripts/document/ai-document-fixture'
import { single_source, type SingleSourceRule } from '#scripts/document/single-source'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#2190. The `backlogrun` parent entry read was cut to a manifest: `backlogrun.md`
// kept the terse trigger-and-pointer flow, and its detailed procedure moved into the reference-only
// `backlogrun-steps.md`, read on demand rather than at the entry — the same move #2189 made for
// `fullrun.md` / `fullrun-steps.md`. This suite is the hold on that move — for each relocated body it
// asserts the body lives in exactly one document, so the reduction cannot be undone by pasting the
// prose back into `backlogrun.md`, `SKILL.md` or any other routing document. It runs the
// `single-source.ts` framework #2188 shipped against the real corpus.

const SKILL_DIR = '.claude/skills/workflow-commands'

// Each rule names a phrase unique to a relocated section body and the one document allowed to carry
// it — `backlogrun-steps.md`. The phrase is verbatim from the body, so a copy pasted back anywhere in
// the routing corpus fails the assertion, which is the reduction's guarantee.
const RELOCATED_BODIES: ReadonlyArray<SingleSourceRule> = [
	{
		marker: 'Two repairs that would bound this the other way are prohibited',
		canonical: `${SKILL_DIR}/backlogrun-steps.md`,
	},
	{
		marker: 'because the order is the point of naming them',
		canonical: `${SKILL_DIR}/backlogrun-steps.md`,
	},
	{
		marker: 'The authorization boundary is carried by the budget, not by the keystroke',
		canonical: `${SKILL_DIR}/backlogrun-steps.md`,
	},
	{
		marker: "one command's output, not an assembly of several",
		canonical: `${SKILL_DIR}/backlogrun-steps.md`,
	},
	{
		marker: "The loop's head is one command",
		canonical: `${SKILL_DIR}/backlogrun-steps.md`,
	},
	{
		marker: 'To become a candidate an issue needs',
		canonical: `${SKILL_DIR}/backlogrun-steps.md`,
	},
	{
		marker: 'Termination is decided by what the loop is told',
		canonical: `${SKILL_DIR}/backlogrun-steps.md`,
	},
	{
		marker: 'There is no epic to audit',
		canonical: `${SKILL_DIR}/backlogrun-steps.md`,
	},
]

describe('the relocated backlogrun-entry prose is single-sourced to backlogrun-steps.md', () => {
	const documents = routing_documents()

	it.each(RELOCATED_BODIES)('holds $canonical as the one home of its body', (rule) => {
		expect(single_source.is_single_sourced(rule, documents, read_repo_file)).toBe(true)
	})

	it.each(RELOCATED_BODIES)('reports no other carrier of $canonical', (rule) => {
		expect(single_source.violations(rule, documents, read_repo_file)).toStrictEqual([])
	})
})

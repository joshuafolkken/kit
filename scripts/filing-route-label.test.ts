import { describe, expect, it } from 'vitest'
import { read_repo_file } from './ai-document-fixture'
import { REVIEW_CAP_ROUTE_LABEL, SPLIT_ROUTE_LABEL, TIER_A_ROUTE_LABEL } from './git/issue-labels'

// joshuafolkken/kit#1083: an added Issue should say, by label, which filing route produced it — a
// review round-cap carry-forward, a split child, or a Tier A filing during implementation — so the
// backlog's composition is countable with `gh api "…/issues?labels=<route>"` instead of grepping
// issue bodies by hand, which is how the 2026-08-30 breakdown was produced and why it did not
// reproduce.
//
// Filing is driven by an agent following prose, so there is no runtime hook that can force the label
// onto the `gh api … issues` call — a per-filing enforcement point does not exist. What *is*
// mechanical is that each filing procedure's documented command carries the label; this suite is
// that guard. It keys every route's filing document to the single-source constant in
// `git/issue-labels.ts`, so a command that drops its route label — or a label whose spelling drifts
// from the constant the aggregation query uses — fails here rather than shipping an uncountable
// filing.

// The `gh api … issues` label flag as it must appear in the filing command.
function label_flag(label: string): string {
	return `-f 'labels[]=${label}'`
}

// Each filing route, the constant that names its label, and the document whose filing command must
// carry it. Tier A files from two procedures — a prerequisite (same repo) and an upstream defect
// (a first-party target) — so both are pinned.
const FILING_ROUTE_COMMANDS: ReadonlyArray<{ route: string; label: string; doc: string }> = [
	{
		route: 'review round-cap carry-forward',
		label: REVIEW_CAP_ROUTE_LABEL,
		doc: 'prompts/review.md',
	},
	{
		route: 'split child',
		label: SPLIT_ROUTE_LABEL,
		doc: '.claude/skills/workflow-commands/kickoff.md',
	},
	{
		route: 'Tier A prerequisite',
		label: TIER_A_ROUTE_LABEL,
		doc: 'prompts/collaboration-workflow/prerequisite-issue.md',
	},
	{
		route: 'Tier A upstream defect',
		label: TIER_A_ROUTE_LABEL,
		doc: 'prompts/collaboration-workflow/upstream-interrupt.md',
	},
]

describe('every filing route labels the issue it creates', () => {
	it.each(FILING_ROUTE_COMMANDS)('$route: $doc files with $label', ({ label, doc }) => {
		expect(read_repo_file(doc)).toContain(label_flag(label))
	})
})

// The workflow-command skills restate the split-child and prerequisite filing procedures an agent
// actually follows during fullrun / halfrun / epicrun — the unattended path where most mid-run
// splits and prerequisites are created. Each restates the instruction in prose rather than the raw
// `gh api` command, so it must name the route label or the run files unlabeled and the count is
// wrong. Pinning the label name here is what stops the canonical wiring from being complete while
// the copies that do the filing are not (joshuafolkken/kit#1083).
const SKILL_ROOT = '.claude/skills/workflow-commands'
// The it.each case name shared by the two label-mention suites below.
const NAMES_LABEL_CASE = '$doc names $label'
const OPERATIONAL_FILING_DOCS: ReadonlyArray<{ doc: string; label: string }> = [
	`${SKILL_ROOT}/fullrun.md`,
	`${SKILL_ROOT}/halfrun.md`,
	`${SKILL_ROOT}/epicrun.md`,
].flatMap((document_) => [
	{ doc: document_, label: SPLIT_ROUTE_LABEL },
	{ doc: document_, label: TIER_A_ROUTE_LABEL },
])

describe('the workflow-command filing copies name their route label', () => {
	it.each(OPERATIONAL_FILING_DOCS)(NAMES_LABEL_CASE, ({ doc, label }) => {
		expect(read_repo_file(doc)).toContain(label)
	})
})

// The canonical extended references must agree with the skill copies above (each of those files
// declares that the two must match). Wiring only the operational layer would leave the declared
// source of truth saying children and prerequisites file unlabeled — the same drift in mirror image.
// The bare-issue epicrun path is a canonical filing site; pin the labels it names so the canonical
// and operational layers cannot diverge (joshuafolkken/kit#1083). The split assessment is the
// exception: joshuafolkken/kit#1174 single-sourced its body into the skill, so only the skill copy
// carries the filing command and the canonical topic file is a pointer with none of its own.
const WORKFLOW_ROOT = 'prompts/collaboration-workflow'
const CANONICAL_FILING_DOCS: ReadonlyArray<{ doc: string; label: string }> = [
	{ doc: `${WORKFLOW_ROOT}/epicrun.md`, label: SPLIT_ROUTE_LABEL },
	{ doc: `${WORKFLOW_ROOT}/epicrun.md`, label: TIER_A_ROUTE_LABEL },
	{ doc: `${SKILL_ROOT}/split-assessment.md`, label: SPLIT_ROUTE_LABEL },
]

describe('the canonical filing references name their route label', () => {
	it.each(CANONICAL_FILING_DOCS)(NAMES_LABEL_CASE, ({ doc, label }) => {
		expect(read_repo_file(doc)).toContain(label)
	})
})

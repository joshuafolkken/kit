// The issue-number citation ceiling of every agent-read document — an exact ratchet.
//
// Issue-number citations and the "why / measured / rejected" prose around them are what swell the
// documents an agent reads at run time; a reduction epic cuts them only for the next PRs to add them
// back, because nothing held the reduced count (joshuafolkken/kit#3185). This list is that hold:
// `issue-citation-budget.test.ts` fails `pnpm josh gate` when an agent-read document cites more issue
// numbers than its entry records, and when it cites fewer — a reduction must lower its entry in the
// same PR, so the ceiling follows the count down and never sits loose above it. A document absent from
// the list has a ceiling of zero. History belongs in `docs/maintainers/<topic>-rationale.md`, which
// this budget does not hold (`docs/maintainers/residency-rationale.md` → "The issue-citation ratchet").
//
// The ratchet is exact rather than block-quantized like `document-byte-budget.ts`: a single added
// citation is the growth this exists to refuse, so there is no headroom to quantize.

interface CitationBudget {
	path: string
	citations: number
}

// An issue number as a document cites it — `#3185` or `joshuafolkken/kit#3185`. Three digits or more,
// so a placeholder (`#N`, `#<N>`) and a list ordinal are not counted.
const CITATION_PATTERN = /#\d{3,}\b/gu

const ISSUE_CITATION_BUDGET: ReadonlyArray<CitationBudget> = [
	{ path: '.claude/skills/epic-commands/epic-bundle.md', citations: 8 },
	{ path: '.claude/skills/epic-commands/execution-waves.md', citations: 7 },
	{ path: '.claude/skills/epic-commands/SKILL.md', citations: 22 },
	{ path: '.claude/skills/verify-ui/SKILL.md', citations: 1 },
	{ path: '.claude/skills/workflow-commands/background-commands.md', citations: 2 },
	{ path: '.claude/skills/workflow-commands/backlogrun-child.md', citations: 1 },
	{ path: '.claude/skills/workflow-commands/backlogrun-lanes.md', citations: 3 },
	{ path: '.claude/skills/workflow-commands/backlogrun-park.md', citations: 2 },
	{ path: '.claude/skills/workflow-commands/backlogrun-progress.md', citations: 18 },
	{ path: '.claude/skills/workflow-commands/backlogrun-recovery.md', citations: 1 },
	{ path: '.claude/skills/workflow-commands/backlogrun-steps.md', citations: 13 },
	{ path: '.claude/skills/workflow-commands/backlogrun.md', citations: 6 },
	{ path: '.claude/skills/workflow-commands/chain-rule.md', citations: 20 },
	{ path: '.claude/skills/workflow-commands/entry-sequence.md', citations: 2 },
	{ path: '.claude/skills/workflow-commands/followup.md', citations: 10 },
	{ path: '.claude/skills/workflow-commands/fullrun-steps.md', citations: 9 },
	{ path: '.claude/skills/workflow-commands/fullrun.md', citations: 6 },
	{ path: '.claude/skills/workflow-commands/halfrun.md', citations: 4 },
	{ path: '.claude/skills/workflow-commands/into-target.md', citations: 8 },
	{ path: '.claude/skills/workflow-commands/issue-comments.md', citations: 1 },
	{ path: '.claude/skills/workflow-commands/kickoff.md', citations: 1 },
	{ path: '.claude/skills/workflow-commands/latest-gate.md', citations: 2 },
	{ path: '.claude/skills/workflow-commands/needs-human-review.md', citations: 1 },
	{ path: '.claude/skills/workflow-commands/observation-filing.md', citations: 13 },
	{ path: '.claude/skills/workflow-commands/observation-ledger.md', citations: 11 },
	{ path: '.claude/skills/workflow-commands/pre-gate-cut.md', citations: 9 },
	{ path: '.claude/skills/workflow-commands/prerequisite.md', citations: 1 },
	{ path: '.claude/skills/workflow-commands/progress-watcher.md', citations: 5 },
	{ path: '.claude/skills/workflow-commands/prrun.md', citations: 1 },
	{ path: '.claude/skills/workflow-commands/retrospective.md', citations: 3 },
	{ path: '.claude/skills/workflow-commands/SKILL.md', citations: 2 },
	{ path: '.claude/skills/workflow-commands/target-repository.md', citations: 8 },
	{ path: '.claude/skills/workflow-commands/working-tree-hold.md', citations: 4 },
	{ path: 'docs/josh-commands-automation.md', citations: 21 },
	{ path: 'docs/josh-commands.md', citations: 2 },
	{ path: 'prompts/collaboration-workflow/file-edits.md', citations: 2 },
	{ path: 'prompts/collaboration-workflow/glossary.md', citations: 1 },
	{ path: 'prompts/collaboration-workflow/issue-citation.md', citations: 2 },
	{ path: 'prompts/collaboration-workflow/issue-template.md', citations: 5 },
	{ path: 'prompts/collaboration-workflow/operating-rules.md', citations: 5 },
	{ path: 'prompts/collaboration-workflow/output-bounds.md', citations: 3 },
	{ path: 'prompts/collaboration-workflow/overview.md', citations: 1 },
	{ path: 'prompts/collaboration-workflow/plan-comment.md', citations: 3 },
	{ path: 'prompts/collaboration-workflow/principles.md', citations: 1 },
	{ path: 'prompts/collaboration-workflow/report-format.md', citations: 8 },
	{ path: 'prompts/collaboration-workflow/residency.md', citations: 3 },
	{ path: 'prompts/collaboration-workflow/rule-delivery.md', citations: 23 },
	{ path: 'prompts/collaboration-workflow/shell-body.md', citations: 2 },
	{ path: 'prompts/collaboration-workflow/turn-batching.md', citations: 6 },
	{ path: 'prompts/collaboration-workflow/upstream-interrupt.md', citations: 1 },
	{ path: 'prompts/collaboration-workflow/wip-cap.md', citations: 3 },
	{ path: 'prompts/refactoring.md', citations: 1 },
	{ path: 'prompts/review-rubric.md', citations: 1 },
	{ path: 'prompts/sonar-hotspot-handling.md', citations: 2 },
	{ path: 'prompts/testing-guide.md', citations: 6 },
]

const BUDGET_FILE = 'scripts/document/issue-citation-budget.ts'

function count_citations(text: string): number {
	return text.match(CITATION_PATTERN)?.length ?? 0
}

// The recorded ceiling for one path — zero when the list carries no entry for it.
function recorded_citations_for(relative_path: string): number {
	return ISSUE_CITATION_BUDGET.find((entry) => entry.path === relative_path)?.citations ?? 0
}

function over_budget_message(relative_path: string, current: number, recorded: number): string {
	const hint = `move the history to docs/maintainers/<topic>-rationale.md, or record ${current.toString()} in ${BUDGET_FILE} so the reason shows in the PR diff`

	return `${relative_path} cites ${current.toString()} issue numbers, over its ceiling of ${recorded.toString()}. Cut the citations — ${hint}.`
}

function stale_budget_message(relative_path: string, current: number, recorded: number): string {
	const hint = `lower its entry to ${current.toString()} in ${BUDGET_FILE} (remove the entry at 0) so the ratchet holds the reduction`

	return `${relative_path} cites ${current.toString()} issue numbers but records ${recorded.toString()}. ${hint}.`
}

// The failure for one document, or undefined when its count equals its record. Growth and a
// reduction left unrecorded both fail, which is what makes the ceiling a ratchet rather than a cap.
function citation_violation(
	relative_path: string,
	current: number,
	recorded: number,
): string | undefined {
	if (current > recorded) return over_budget_message(relative_path, current, recorded)
	if (current < recorded) return stale_budget_message(relative_path, current, recorded)

	return undefined
}

const issue_citation_budget = {
	ISSUE_CITATION_BUDGET,
	citation_violation,
	count_citations,
	recorded_citations_for,
}

export type { CitationBudget }
export { issue_citation_budget }

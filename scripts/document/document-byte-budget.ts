// The byte ceiling for every document an agent reads in full — in one place, as a ratchet.
//
// Agent-read documents (`CLAUDE.md`, `.claude/skills/**/*.md`, `prompts/**/*.md` and
// `docs/josh-commands.md`) have been shrunk by reduction epics (joshuafolkken/kit#1929,
// joshuafolkken/kit#1924) only to swell again, because nothing held the reduced size — a PR that
// adds a few lines at a time goes unseen until the next reduction epic. This list is that hold:
// `document-byte-budget.test.ts` fails `pnpm josh gate` when a document grows past its recorded
// size plus a small slack, when the list names a file that no longer exists, or when a file in
// scope has no entry here.
//
// HOW TO RAISE (or LOWER) A CEILING — this file is the only place, on purpose. Each entry's `bytes`
// is the document's recorded byte size; the effective ceiling is that value plus `SLACK_BYTES`. A
// change that grows a document past its ceiling must raise that document's recorded size here, in
// the same PR, so the reason for the growth is visible in the diff a reviewer reads. A reduction
// epic that shrinks a document lowers its recorded size here the same way. Do NOT widen
// `SLACK_BYTES` to dodge a bump — that loosens every ceiling at once, which is the opposite of the
// ratchet's purpose.
//
// It is a list of records rather than a path-keyed object because file paths are not valid object
// property names under the naming-convention lint rule.

interface DocumentBudget {
	path: string
	bytes: number
}

// The small margin every recorded size is allowed to grow by before the gate fires. Kept tight so a
// meaningful addition to a document has to be recorded here rather than slipping through.
const SLACK_BYTES = 512

// `docs/josh-commands.md` is held near 80 KB — the target joshuafolkken/kit#1929 set but never
// enforced. Its recorded size plus `SLACK_BYTES` must stay at or below this, pinned by a dedicated
// test so a careless bump cannot push it over silently. joshuafolkken/kit#1988 raised it one slack
// unit (80,000 → 80,512) for the kit-only annotation on `josh eval`, the mandated doc update landing
// against a document #1978 had already filled to the 80,000 mark. joshuafolkken/kit#2002 raised it a
// further slack unit (80,512 → 81,024) for the mandated `josh lane:dispatch` update documenting the
// dispatch-time `in-progress` apply, again landing against a document already at its mark.
// joshuafolkken/kit#2024 raised it two slack units (81,024 → 82,048) for the mandated `josh
// run:merge` section: the section landed against a document already at its mark, and the branch's own
// merge with `main` layered a concurrent doc addition on top, so the merged tree the CI gate measures
// needed the second unit that the branch tree alone did not. joshuafolkken/kit#2050 raised it four
// slack units (82,048 → 84,096) for the mandated `josh stash:pop` section — its command reference and
// the `conflicted` verdict — landing against a document already at its mark.
// joshuafolkken/kit#2113 raised it three slack units (84,096 → 85,632) for the mandated
// `josh run:watcher:guard` and `josh lane:await` sections. joshuafolkken/kit#2136 raised it two slack
// units (85,632 → 86,656) for the mandated `josh run:carry --end --stopped` documentation — the
// `--stopped` option and its example line — landing against a document already at its mark.
// joshuafolkken/kit#2138 raised it two slack units (86,656 → 87,680) for the mandated `josh
// batch:guard`, `josh investigation:guard` and `josh pretool:guard` notes recording that the
// interactive-line guards stand down for a dispatched lane child, per the one-place enumeration in
// `scripts/lane/lane-guard-policy.ts`; the merge with `main` layered #2136's addition on top, so the
// merged tree needs a unit the branch alone did not. joshuafolkken/kit#2139 raised it four slack
// units (87,680 → 89,728) for the mandated `josh run:ending` section — its command reference, the four
// ending verdicts (`merged` / `cut` / `abandoned` / `unreadable`) and its `--output` / `--repo`
// options — landing against a document already at its mark. joshuafolkken/kit#2118 raised it one slack
// unit (89,728 → 90,240) for the mandated `josh test:declared` section — its command reference and the
// three verdicts (`required` / `exempt` / `satisfied`) — landing against a document already at its
// mark, the branch's merge with `main` layering the section on top of a document `main` had already
// filled. joshuafolkken/kit#2122 raised it two slack units (90,240 → 91,264) for the mandated `josh
// repo:party` section — its command reference and the three verdicts (`first-party` / `third-party` /
// `unknown`) — landing against a document already at its mark. joshuafolkken/kit#2123 raised it five
// slack units (91,264 → 93,824) for the mandated `josh issue:lint`, `josh issue:backlinks` and `josh
// report:lint` sections — the three new fixed-shape-artifact linters, their command references and
// their verdicts — landing against a document already at its mark. joshuafolkken/kit#2164 raised it
// three slack units (93,824 → 95,360) for the mandated `josh batch:guard` / `josh pretool:guard`
// rewrite recording the three-valued lane-child mode (`refuse` / `notice` / `off`) and the
// re-fire-every-`REFIRE_EVERY` batching cadence, landing against a document already at its mark.
// joshuafolkken/kit#2160 raised it one slack unit (95,360 → 95,872) for the mandated `josh lane:open`
// note recording that a lane also copies the pre-built `dist/hooks/` bundles from the main checkout —
// why the copy is needed for kit's own lanes and not for a consumer repository — landing against a
// document already at its mark. joshuafolkken/kit#2162 raised it four slack units (95,872 → 97,920) for
// the mandated `josh backlog:offer` and `josh lane:launch` sections — the two composite loop commands,
// their command references and their stdout/stderr contracts — landing against a document already at
// its mark.
const JOSH_COMMANDS_CEILING_BYTES = 97_920

// Recorded byte size of each agent-read document. Must name exactly the set `agent_read_documents()`
// enumerates — the test fails on a stale entry (a file that no longer exists) and on an un-budgeted
// file (one in scope with no entry), so the definition cannot rot as documents are added or removed.
const DOCUMENT_BYTE_BUDGET: ReadonlyArray<DocumentBudget> = [
	{ path: '.claude/skills/dependency-update/SKILL.md', bytes: 5064 },
	{ path: '.claude/skills/epic-commands/SKILL.md', bytes: 32_596 },
	{ path: '.claude/skills/verify-ui/SKILL.md', bytes: 5320 },
	// joshuafolkken/kit#2161 moved §2a / §2c / §3's bodies out of SKILL.md into `into-target.md`,
	// `target-repository.md` and `rule-residency.md`, so SKILL.md shrinks and the two new files and
	// `rule-residency.md` grow — a relocation, held on both sides by the ratchet.
	{ path: '.claude/skills/workflow-commands/SKILL.md', bytes: 57_145 },
	{ path: '.claude/skills/workflow-commands/background-commands.md', bytes: 8180 },
	{ path: '.claude/skills/workflow-commands/backlogrun-child.md', bytes: 26_291 },
	{ path: '.claude/skills/workflow-commands/backlogrun-lanes.md', bytes: 26_442 },
	{ path: '.claude/skills/workflow-commands/backlogrun-park.md', bytes: 11_889 },
	{ path: '.claude/skills/workflow-commands/backlogrun-progress.md', bytes: 41_667 },
	{ path: '.claude/skills/workflow-commands/backlogrun.md', bytes: 51_893 },
	{ path: '.claude/skills/workflow-commands/chain-rule.md', bytes: 6240 },
	{ path: '.claude/skills/workflow-commands/followup-reference.md', bytes: 13_066 },
	{ path: '.claude/skills/workflow-commands/followup.md', bytes: 12_667 },
	{ path: '.claude/skills/workflow-commands/fullrun.md', bytes: 16_604 },
	{ path: '.claude/skills/workflow-commands/halfrun.md', bytes: 11_479 },
	{ path: '.claude/skills/workflow-commands/into-target.md', bytes: 3156 },
	{ path: '.claude/skills/workflow-commands/kickoff.md', bytes: 7599 },
	{ path: '.claude/skills/workflow-commands/latest-gate.md', bytes: 5124 },
	{ path: '.claude/skills/workflow-commands/observation-filing.md', bytes: 23_956 },
	{ path: '.claude/skills/workflow-commands/pre-gate-cut.md', bytes: 26_629 },
	{ path: '.claude/skills/workflow-commands/rule-residency.md', bytes: 23_282 },
	{ path: '.claude/skills/workflow-commands/split-assessment.md', bytes: 6558 },
	{ path: '.claude/skills/workflow-commands/target-repository.md', bytes: 4274 },
	{ path: 'CLAUDE.md', bytes: 26_907 },
	{ path: 'docs/josh-commands.md', bytes: 97_302 },
	{ path: 'prompts/agent-rules.md', bytes: 3472 },
	{ path: 'prompts/coding-standards.md', bytes: 15_805 },
	{ path: 'prompts/collaboration-workflow.md', bytes: 7353 },
	{ path: 'prompts/collaboration-workflow/consultation-vs-execution.md', bytes: 1108 },
	{ path: 'prompts/collaboration-workflow/cross-repo-epic.md', bytes: 5541 },
	{ path: 'prompts/collaboration-workflow/distributed-docs.md', bytes: 854 },
	{ path: 'prompts/collaboration-workflow/durable-rules.md', bytes: 2451 },
	{ path: 'prompts/collaboration-workflow/epic-audit.md', bytes: 8383 },
	{ path: 'prompts/collaboration-workflow/epic-bundle.md', bytes: 23_605 },
	{ path: 'prompts/collaboration-workflow/file-edits.md', bytes: 12_147 },
	{ path: 'prompts/collaboration-workflow/gh-rest.md', bytes: 4494 },
	{ path: 'prompts/collaboration-workflow/issue-citation.md', bytes: 3103 },
	{ path: 'prompts/collaboration-workflow/issue-template.md', bytes: 19_064 },
	{ path: 'prompts/collaboration-workflow/latest-first.md', bytes: 2625 },
	{ path: 'prompts/collaboration-workflow/no-clones.md', bytes: 1614 },
	{ path: 'prompts/collaboration-workflow/operating-rules.md', bytes: 22_971 },
	{ path: 'prompts/collaboration-workflow/output-bounds.md', bytes: 12_942 },
	{ path: 'prompts/collaboration-workflow/overview.md', bytes: 4518 },
	{ path: 'prompts/collaboration-workflow/plan-comment.md', bytes: 16_801 },
	{ path: 'prompts/collaboration-workflow/proposal-request.md', bytes: 488 },
	{ path: 'prompts/collaboration-workflow/report-format.md', bytes: 19_530 },
	{ path: 'prompts/collaboration-workflow/residency.md', bytes: 17_830 },
	{ path: 'prompts/collaboration-workflow/rule-delivery.md', bytes: 36_055 },
	{ path: 'prompts/collaboration-workflow/shell-body.md', bytes: 8133 },
	{ path: 'prompts/collaboration-workflow/single-source-rules.md', bytes: 1764 },
	{ path: 'prompts/collaboration-workflow/turn-batching.md', bytes: 18_726 },
	{ path: 'prompts/collaboration-workflow/upstream-interrupt.md', bytes: 11_920 },
	{ path: 'prompts/collaboration-workflow/wip-cap.md', bytes: 17_057 },
	{ path: 'prompts/refactoring.md', bytes: 8372 },
	{ path: 'prompts/review-rubric.md', bytes: 18_268 },
	{ path: 'prompts/review.md', bytes: 17_103 },
	{ path: 'prompts/sonar-hotspot-handling.md', bytes: 4660 },
	{ path: 'prompts/testing-guide.md', bytes: 19_774 },
]

// The effective ceiling: the recorded size plus the shared slack.
function ceiling_for(recorded_bytes: number): number {
	return recorded_bytes + SLACK_BYTES
}

// The recorded size for one path, or undefined when it carries no budget entry.
function recorded_bytes_for(relative_path: string): number | undefined {
	return DOCUMENT_BYTE_BUDGET.find((entry) => entry.path === relative_path)?.bytes
}

// The failure message the size test raises — names the file, its current byte size, its ceiling, and
// where to raise the ceiling (this file), per the acceptance criteria.
function over_budget_message(
	relative_path: string,
	current_bytes: number,
	recorded_bytes: number,
): string {
	const ceiling = ceiling_for(recorded_bytes).toString()
	const current = current_bytes.toString()
	const recorded = `${recorded_bytes.toString()} + ${SLACK_BYTES.toString()} slack`
	const raise_hint = `raise its recorded size in scripts/document/document-byte-budget.ts so the reason shows in the PR diff`

	return `${relative_path} is ${current} bytes, over its ${ceiling}-byte ceiling (recorded ${recorded}). Shrink the document, or ${raise_hint}.`
}

// The failure message the staleness test raises. A recorded size sitting more than `SLACK_BYTES`
// above the document's actual size is a stale-loose ratchet: the document shrank and its record was
// never lowered, so the ceiling no longer holds the reduction — the drift joshuafolkken/kit#2125 swept
// (chain-rule.md was cut in joshuafolkken/kit#2078 but its record stayed at 18,031). It names the
// file, its recorded size, its actual size, the gap, and where to lower the record.
function stale_budget_message(
	relative_path: string,
	recorded_bytes: number,
	current_bytes: number,
): string {
	const recorded = recorded_bytes.toString()
	const current = current_bytes.toString()
	const gap = (recorded_bytes - current_bytes).toString()
	const lower_hint = `lower its recorded size in scripts/document/document-byte-budget.ts so the ratchet holds the reduction`

	return `${relative_path} records ${recorded} bytes but is ${current} (stale by ${gap}, over ${SLACK_BYTES.toString()} slack). ${lower_hint}.`
}

const document_byte_budget = {
	DOCUMENT_BYTE_BUDGET,
	JOSH_COMMANDS_CEILING_BYTES,
	SLACK_BYTES,
	ceiling_for,
	over_budget_message,
	recorded_bytes_for,
	stale_budget_message,
}

export type { DocumentBudget }
export { document_byte_budget }

// The byte ceiling for every agent-read document NO entry reads — the fallback budget, a ratchet.
//
// **This is now the secondary budget** (joshuafolkken/kit#2257). The primary one is the entry total
// (`entry-read-budget.ts`): a document a workflow entry reads is held by that entry's total and
// carries no ceiling here, so neither budget holds it twice. What is left for this list is the
// documents no entry reads — the reference documents a human browses, drawn by
// `document-reachability.ts` from `read:set`'s output rather than by a hand-written table.
//
// Agent-read documents (`.claude/skills/**/*.md`, `prompts/**/*.md` and the two `docs/josh-commands*.md` references) have
// been shrunk by reduction epics (joshuafolkken/kit#1929, joshuafolkken/kit#1924) only to swell
// again, because nothing held the reduced size — a PR that adds a few lines at a time goes unseen
// until the next reduction epic. This list is that hold for the unreached ones:
// `document-byte-budget.test.ts` fails `pnpm josh gate` when such a document grows past its recorded
// ceiling, when the list names a file that no longer exists, or when an unreached file has no entry
// here.
//
// THE RECORDED CEILING IS BLOCK-QUANTIZED — this is what stops parallel command-adding lanes from
// serializing on this file (joshuafolkken/kit#2231). Each entry's `bytes` is not the document's exact
// size but the smallest multiple of `BLOCK_BYTES` at or above it, and that value IS the ceiling. A
// document that grows within its current block needs no edit here, so most command-adding PRs leave
// this file untouched rather than bumping a shared line; a document that crosses a block boundary
// bumps to the next multiple — the same value from every lane, an identical change git auto-merges,
// not a hand-picked slack unit two branches fight over. Growth is still bounded: the block is the
// whole of a document's headroom, so it cannot swell without a visible, deterministic bump in the
// diff. This replaced the earlier exact-size-plus-512-slack ratchet, whose tight slack forced
// `docs/josh-commands.md` — pinned at its ceiling — to bump on every command addition, the
// serialization point #2231 removed. It also retired the bespoke `JOSH_COMMANDS_CEILING_BYTES` hard
// cap and its per-bump changelog comment: the uniform block ratchet now holds that document like any
// other, so the second cap was a second line to bump for no added hold.
//
// HOW TO RAISE (or LOWER) A CEILING — this file is the only place, on purpose. When the gate reports a
// document over its ceiling, copy the exact value the message names (the next block multiple) into
// that document's entry, in the same PR, so the reason for the growth is visible in the diff a
// reviewer reads. A reduction epic that shrinks a document below a block lowers its entry the same
// way, to the multiple the stale-ratchet message names. Do NOT widen `BLOCK_BYTES` to dodge a bump —
// that loosens every ceiling at once, which is the opposite of the ratchet's purpose.
//
// It is a list of records rather than a path-keyed object because file paths are not valid object
// property names under the naming-convention lint rule.

interface DocumentBudget {
	path: string
	bytes: number
}

// The quantization block. A recorded ceiling is a multiple of this, so a document growing within a
// block needs no edit and one crossing a boundary bumps to the same next multiple from every lane —
// the property that keeps parallel lanes from conflicting on this file. Kept small enough that the
// ratchet still holds growth tightly: the block is the entire headroom a document has before its next
// deterministic bump. Widening it to dodge a bump is the workaround the ratchet exists to forbid, so
// its value is pinned by a test.
const BLOCK_BYTES = 4096

// The smallest multiple of `BLOCK_BYTES` at or above `size` — the recorded ceiling for a document of
// that size. Two lanes that grow the same document into the same block compute the same ceiling, so
// the edit they both make is identical and merges cleanly; a document growing within its block
// computes the ceiling it already has, so it needs no edit at all.
function block_ceiling(size: number): number {
	return Math.ceil(size / BLOCK_BYTES) * BLOCK_BYTES
}

// Recorded byte ceiling of each unreached document — the block multiple at or above its size. Must
// name exactly the documents `document_reachability.unreached_documents()` derives: the test fails on
// a stale entry (a file that no longer exists or that an entry now reads) and on an un-budgeted
// unreached file, so the definition cannot rot as documents move on or off the execution path.
const DOCUMENT_BYTE_BUDGET: ReadonlyArray<DocumentBudget> = [
	{ path: '.claude/skills/dependency-update/SKILL.md', bytes: 8192 },
	// joshuafolkken/kit#3173 split the waves and the `epic:bundle` detail into lazily read references.
	{ path: '.claude/skills/epic-commands/SKILL.md', bytes: 20_480 },
	{ path: '.claude/skills/epic-commands/epic-bundle.md', bytes: 12_288 },
	{ path: '.claude/skills/epic-commands/execution-waves.md', bytes: 12_288 },
	{ path: '.claude/skills/verify-ui/SKILL.md', bytes: 8192 },
	{ path: '.claude/skills/workflow-commands/followup-reference.md', bytes: 16_384 },
	{ path: '.claude/skills/workflow-commands/fullrun-steps.md', bytes: 8192 },
	{ path: '.claude/skills/workflow-commands/into-target.md', bytes: 4096 },
	{ path: '.claude/skills/workflow-commands/issue-comments.md', bytes: 8192 },
	{ path: '.claude/skills/workflow-commands/issue-fold-existing.md', bytes: 4096 },
	{ path: '.claude/skills/workflow-commands/needs-human-review.md', bytes: 8192 },
	{ path: '.claude/skills/workflow-commands/observation-filing.md', bytes: 24_576 },
	// `pre-gate-cut.md` left this per-document budget in joshuafolkken/kit#2289: it became a point-of-use
	// document, so its bytes are now held by every entry's total read (`entry-read-budget.ts`) and the
	// two budgets must not hold it twice — the reachability line moved it from `unreached` to
	// `point-of-use`.
	{ path: '.claude/skills/workflow-commands/prerequisite.md', bytes: 8192 },
	{ path: '.claude/skills/workflow-commands/target-repository.md', bytes: 8192 },
	{ path: '.claude/skills/workflow-commands/working-tree-hold.md', bytes: 8192 },
	// joshuafolkken/kit#2998 split the reference: the developer commands stay, the rest moved out.
	// joshuafolkken/kit#3175 raised it: the supervisor, provider-table and answer-to-budget prose moved
	// here out of `backlogrun-steps.md`, so a run reads it only when it asks about those commands.
	{ path: 'docs/josh-commands-automation.md', bytes: 159_744 },
	{ path: 'docs/josh-commands.md', bytes: 36_864 },
	{ path: 'prompts/coding-standards.md', bytes: 8192 },
	{ path: 'prompts/collaboration-workflow.md', bytes: 8192 },
	{ path: 'prompts/collaboration-workflow/file-edits.md', bytes: 12_288 },
	{ path: 'prompts/collaboration-workflow/gh-rest.md', bytes: 8192 },
	{ path: 'prompts/collaboration-workflow/glossary.md', bytes: 4096 },
	{ path: 'prompts/collaboration-workflow/issue-citation.md', bytes: 4096 },
	// #3178 left the template and the judgement tables; the epic commands moved to `epic-commands`, the by-hand fallback stayed.
	{ path: 'prompts/collaboration-workflow/issue-template.md', bytes: 8192 },
	{ path: 'prompts/collaboration-workflow/operating-rules.md', bytes: 12_288 },
	{ path: 'prompts/collaboration-workflow/output-bounds.md', bytes: 16_384 },
	{ path: 'prompts/collaboration-workflow/overview.md', bytes: 4096 },
	// #3178 replaced the review-chain restatement with a pointer to `chain-rule.md`.
	{ path: 'prompts/collaboration-workflow/plan-comment.md', bytes: 8192 },
	{ path: 'prompts/collaboration-workflow/principles.md', bytes: 12_288 },
	{ path: 'prompts/collaboration-workflow/proposal-request.md', bytes: 4096 },
	// #3178 dropped the restatements `report:lint` and `chain-rule.md` already carry.
	{ path: 'prompts/collaboration-workflow/report-format.md', bytes: 16_384 },
	{ path: 'prompts/collaboration-workflow/residency.md', bytes: 28_672 },
	// #3186 moved the hook wiring and history to `docs/maintainers/rule-delivery-rationale.md`;
	// #3179 adds the `index-mutation` / `destructive-command` / `protected-file` entries.
	{ path: 'prompts/collaboration-workflow/rule-delivery.md', bytes: 20_480 },
	{ path: 'prompts/collaboration-workflow/shell-body.md', bytes: 8192 },
	{ path: 'prompts/collaboration-workflow/turn-batching.md', bytes: 20_480 },
	{ path: 'prompts/collaboration-workflow/upstream-interrupt.md', bytes: 12_288 },
	{ path: 'prompts/collaboration-workflow/wip-cap.md', bytes: 16_384 },
	{ path: 'prompts/refactoring.md', bytes: 8192 },
	{ path: 'prompts/review-rubric.md', bytes: 20_480 },
	{ path: 'prompts/review.md', bytes: 20_480 },
	{ path: 'prompts/sonar-hotspot-handling.md', bytes: 8192 },
	{ path: 'prompts/testing-guide.md', bytes: 24_576 },
]

// The recorded ceiling for one path, or undefined when it carries no budget entry.
function recorded_bytes_for(relative_path: string): number | undefined {
	return DOCUMENT_BYTE_BUDGET.find((entry) => entry.path === relative_path)?.bytes
}

// The bytes an entry has left before its ceiling — the recorded ceiling minus the document's current
// size. Negative when the document is already over. `josh bytes` prints it as the headroom before an
// edit, the same number `josh lines` prints for code lines (joshuafolkken/kit#2176).
function remaining_bytes(recorded_bytes: number, current_bytes: number): number {
	return recorded_bytes - current_bytes
}

// The failure message the size test raises — names the file, its current byte size, its recorded
// ceiling, and where to raise it (this file), per the acceptance criteria.
//
// **It names the exact value to record**: the recorded ceiling is the block multiple at or above the
// document's size, so the number to write is `block_ceiling(current)` — a reader raising the ceiling
// copies it rather than computing it by hand. Two lanes that both cross into the same block copy the
// same value, so the edit they make merges without conflict.
function over_budget_message(
	relative_path: string,
	current_bytes: number,
	recorded_bytes: number,
): string {
	const ceiling = recorded_bytes.toString()
	const current = current_bytes.toString()
	const next = block_ceiling(current_bytes).toString()
	const raise_hint = `raise its recorded size to ${next} in scripts/document/document-byte-budget.ts so the reason shows in the PR diff`

	return `${relative_path} is ${current} bytes, over its ${ceiling}-byte ceiling. Shrink the document, or ${raise_hint}.`
}

// The failure message the staleness test raises. A recorded ceiling more than a block above the
// document's actual size is a stale-loose ratchet: the document shrank across a block boundary and
// its record was never lowered, so the ceiling no longer holds the reduction (the drift
// joshuafolkken/kit#2125 swept). It names the file, its recorded ceiling, its actual size, and the
// block multiple to lower the record to.
function stale_budget_message(
	relative_path: string,
	recorded_bytes: number,
	current_bytes: number,
): string {
	const recorded = recorded_bytes.toString()
	const current = current_bytes.toString()
	const next = block_ceiling(current_bytes).toString()
	const lower_hint = `lower its recorded size to ${next} in scripts/document/document-byte-budget.ts so the ratchet holds the reduction`

	return `${relative_path} records ${recorded} bytes but is ${current}, more than a block above actual. ${lower_hint}.`
}

const document_byte_budget = {
	DOCUMENT_BYTE_BUDGET,
	BLOCK_BYTES,
	block_ceiling,
	over_budget_message,
	recorded_bytes_for,
	remaining_bytes,
	stale_budget_message,
}

export type { DocumentBudget }
export { document_byte_budget }

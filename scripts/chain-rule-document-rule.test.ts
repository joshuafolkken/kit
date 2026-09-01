import { read_index, read_unwrapped } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// The chain rule — `/code-review` output is not a turn boundary, and a `fullrun` continues through
// `bump minor` → `git -y` → `followup --merge` — was written twice: once in English in the skill a
// run actually reads, and once in `plan-comment.md`, four sections of it. Two copies of a rule that
// exists because agents stop where they should not is the clone `CLAUDE.md` prohibits, sitting in
// the document that states the prohibition.
//
// joshuafolkken/kit#1186 single-sources it into the skill (the joshuafolkken/kit#1174 pattern,
// rolled out under joshuafolkken/kit#1176). This topic is the first of the rollout whose canonical
// text was **one section of a file that holds another topic too**: `plan-comment.md` also carries
// Step 3, and `fullrun.md` cites it for exactly that. So the section was extracted into its own
// topic file and that file shrunk to a pointer, rather than the declaration being placed mid-file.
// What decides it is the citations, not the sizes: detection and the no-citation rule are both per
// file, so declaring `plan-comment.md` a pointer turns the Step 3 citation `fullrun.md` legitimately
// carries into a violation. The alternative — making the detection section-aware — needs a second
// mechanism that decides which section a citation naming no section belongs to, which is the
// judgement joshuafolkken/kit#1178 removed.

const SKILL = '.claude/skills/workflow-commands/chain-rule.md'
const POINTER = 'prompts/collaboration-workflow/chain-rule.md'
// The file the section was extracted from. It keeps Step 3, and keeps being cited for it.
const STEP_THREE = 'prompts/collaboration-workflow/plan-comment.md'
const REVIEW_PROMPT = 'prompts/review.md'
const RESIDENCY = 'prompts/collaboration-workflow/residency.md'
// Asserted twice on purpose: present in the single source, absent from both files it was cut from.
const TOOLING_HEADING = 'Tooling enforcement (investigated, not implemented)'
const TOOLING_VERDICT = 'not feasible at the tooling layer'

// The rule itself, in the single source. Each marker is one of the parts a reword most easily
// loses — and each has been lost in practice, which is why the rule carries a self-check at all.
const RULE_MARKERS: ReadonlyArray<string> = [
	// Without this sentence the review output reads as a deliverable, and the run reports it and waits.
	'the `/code-review` skill output is **not** a turn boundary',
	// Exactly two, and the blockers exactly three: an open-ended list of "genuine blockers" is how a
	// clean review became one.
	'**`fullrun` STOPPING CONDITIONS** (the chain ends only here)',
	'A CodeRabbit / Claude Review substantive finding that cannot be auto-verified as a false positive',
	'The managed config-file confirmation gate',
	'A CI failure that requires user input to resolve',
	// The recommendation line is the thing most often mistaken for the verdict.
	'**Severity of findings drives the decision, not the recommendation sentence.**',
	'**Decision table** (map `/code-review` result → next action mechanically)',
	'**Anti-pattern catalog**',
	'Turn-end self-check',
	// The cap and its exits: an unbounded loop does not terminate, and a finding filed without the
	// bundle step is parked rather than deferred.
	'**at most two reviews in total**',
	'route each remaining non-High finding through the three-way disposition',
	'run `pnpm josh epic:bundle <new>` on it before this Issue closes',
]

describe(`${SKILL} — the single source states the rule`, () => {
	const content = read_unwrapped(SKILL)

	it.each(RULE_MARKERS)('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// What the canonical section alone used to carry. `SKILL.md` → "Trimming is moving, never
// deleting.": each of these had to exist in the single source before the canonical text was cut, so
// they are pinned by name rather than left to be noticed missing later.
describe(`${SKILL} — carries what only the canonical section had`, () => {
	const content = read_unwrapped(SKILL)

	// The self-check's first step is a conditional, and the reason is the case it excludes. Dropped,
	// the check reads as unconditional and a review the user asked for on its own gets merged.
	it('says why the mode check is the first step', () => {
		expect(content).toContain('you are in **standalone mode**, not fullrun mode')
		expect(content).toContain('`/code-review <PR>` typed on its own is a review and nothing else')
	})

	// The self-check exists because the rule was violated with the table and the catalog already in
	// place. Without the two violations it reads as belt-and-braces and is the first thing trimmed.
	it('names the violations the self-check was written after', () => {
		expect(content).toContain('PR #387 on 2026-05-15, PR #398 on 2026-05-20')
	})

	// The copy in the review skill's own prompt is deliberate, not drift: the violation happens where
	// that skill finishes producing markdown, which is a context the always-loaded documents do not
	// reach. Unexplained, the next reader deletes one of the two as a duplicate.
	it('says why the self-check is mirrored in the review prompt', () => {
		expect(content).toContain(`mirrored at the end of the \`/code-review\` skill prompt`)
		expect(content).toContain('visible inside the skill')
	})

	// The dead end, recorded so it is not re-derived. A wrapper cannot host an interactive skill or
	// read its severities, which is why the enforcement is prose in the first place.
	it('records that CLI enforcement was investigated and is not feasible', () => {
		expect(content).toContain(TOOLING_HEADING)
		expect(content).toContain(`is ${TOOLING_VERDICT}`)
	})
})

// The pointer half. The generic size and citation rules are asserted for every converted topic by
// `pointer-citation-document-rule.test.ts`; what is specific here is that the body did not stay
// behind — in the new pointer, or in the file the section was extracted from.
describe('the canonical topic file is a pointer to the skill single source', () => {
	const pointer = read_unwrapped(POINTER)

	it.each([SKILL, 'クローン禁止・単一ソース化'])(
		'names the skill as the single source: %j',
		(marker) => {
			expect(pointer).toContain(marker)
		},
	)

	// The extraction is the decision this Issue was asked to make, so the pointer records it where
	// the next conversion of a shared file will read it rather than only in the Issue comment.
	it('records why the section was extracted rather than declared in place', () => {
		expect(pointer).toContain(
			'1 ファイルに複数の話題があるときは、節を話題ファイルへ切り出してから縮小する',
		)
	})

	// One marker per section the canonical used to carry. The generic size check compares this
	// pointer against the whole skill, so a single section creeping back would stay far under it.
	it.each([
		'may stop in exactly 2 situations',
		'Map the result mechanically',
		'Awaiting your go-ahead to merge',
		'Run this check, in order, before sending any response',
		TOOLING_VERDICT,
	])('does not duplicate the rule body: %j', (marker) => {
		expect(pointer).not.toContain(marker)
	})

	// A back-reference from the single source itself costs no second hop, and it is what tells a
	// reader who landed on the skill that the topic file holds no body.
	it('is named as a pointer by the skill that now holds the body', () => {
		expect(read_unwrapped(SKILL)).toContain(`\`${POINTER}\` is a pointer to it`)
	})

	// The index is the only route to a pointer, so a topic file it does not list is unreachable.
	it('is listed in the index', () => {
		expect(read_index()).toContain('(./collaboration-workflow/chain-rule.md)')
	})
})

// The file the section came out of. It keeps Step 3 — and keeps being cited for it — so the test
// that it lost the chain rule has to be paired with the test that it lost nothing else.
describe(`${STEP_THREE} — keeps Step 3 and routes the chain rule away`, () => {
	const content = read_unwrapped(STEP_THREE)

	it.each([
		'## Step 3: 計画コメントを記録して通知する',
		'pnpm josh notify --task-type planning',
		'レビュー工程は実装セッションがコミット前に実行する',
	])('still carries %j', (marker) => {
		expect(content).toContain(marker)
	})

	it.each([
		'`fullrun` STOPPING CONDITIONS — read this before you stop',
		'Chain rule: `/code-review` → `followup --merge` decision table',
		'Anti-pattern catalog (concrete violation phrases',
		TOOLING_HEADING,
	])('no longer carries %j', (marker) => {
		expect(content).not.toContain(marker)
	})

	it('points at the skill that now holds the rule', () => {
		expect(content).toContain(SKILL)
	})
})

// joshuafolkken/kit#1178: a citation names the file the body is in. Both of these named the section
// while it lived in `plan-comment.md`, and a citation left behind resolves to a section that is no
// longer there.
describe('the citations follow the body', () => {
	it.each([REVIEW_PROMPT, RESIDENCY])('%s cites the skill, not the topic file', (path) => {
		expect(read_unwrapped(path)).toContain(SKILL)
	})

	// Unwrapped like every positive assertion here: a negative one read raw passes vacuously the
	// moment the formatter reflows the phrase across a line break, which is the regression it exists
	// to catch going undetected.
	it(`${REVIEW_PROMPT} no longer names the file the section left`, () => {
		expect(read_unwrapped(REVIEW_PROMPT)).not.toContain(
			`chain-rule decision table in \`CLAUDE.md\``,
		)
	})
})

import { readdirSync } from 'node:fs'
import { cost_tokens } from '#scripts/cost-runtime/cost-tokens'
import {
	AI_DOCS,
	read_repo_file,
	read_unwrapped,
	WORKFLOW_PROMPT,
} from '#scripts/document/ai-document-fixture'
import { resident_budget } from '#scripts/document/resident-budget'
import { init_logic } from '#scripts/init/init-logic'
import { describe, expect, it } from 'vitest'
import { package_file, read_skill_file, SKILL_ROOT } from './skill-fixture'
import { skill_meta } from './skill-meta'

// joshuafolkken/kit#854: the three AI documents are read in full on every turn, and roughly half of
// each was procedure for a workflow most turns never enter. Those sections now live in skills the
// documents route to. The split only holds if three things are true together — the skills ship, the
// documents route to them, and the prohibitions that have to fire *before* a skill is loaded stay
// resident — so all three are asserted here rather than left to the section that moved.
const WORKFLOW_SKILL = '.claude/skills/workflow-commands'
const DEPENDENCY_SKILL = '.claude/skills/dependency-update'
// The canonical topic file for the residency criterion. Named directly rather than reached through
// `WORKFLOW_PROMPT`, which answers with the whole concatenated corpus: an assertion about where the
// ceiling policy is argued has to fail when it is argued somewhere else.
const RESIDENCY_TOPIC = 'prompts/collaboration-workflow/residency.md'
// joshuafolkken/kit#3177 cut the topic file down to its four questions; the resident-rule list, the
// budget and its raise conditions moved here, so their markers are asserted at this file.
const RESIDENCY_RATIONALE = 'docs/maintainers/residency-rationale.md'
const NOT_ASPIRATIONAL_MARKER = '**This criterion is not aspirational.**'

// Long enough that it says when to read the skill rather than merely naming it — the description is
// what an agent matches the situation against, so a one-liner ships a skill nothing ever opens.
const MINIMUM_DESCRIPTION_LENGTH = 80

// The resident budget's constants live in `resident-budget.ts` (joshuafolkken/kit#3171), so
// `josh bytes CLAUDE.md` counts against the number this suite enforces.
const { EFFECTIVE_CEILING_BYTES, RE_INLINE_GUARD_HEADROOM_BYTES } = resident_budget

// joshuafolkken/kit#1151: the budget above is held in bytes and the bill arrives in tokens, so a
// reduction could not be read in the unit it is paid in. This is the same limit expressed in that
// unit, **derived** from the byte budget rather than chosen beside it — for pure ASCII, where one
// byte is one character, the two are the same limit, which is what "does not contradict the byte
// ceiling" has to mean.
//
// It is a second *unit*, not a second, tighter guard. Where the two differ is where a byte buys a
// different number of tokens: every non-ASCII character costs one token, so a two-byte one costs a
// token per two bytes against ASCII's three and the token ceiling binds first, while a four-byte one
// costs a token per four and the byte ceiling does. Japanese, at three bytes per character, lands
// exactly on the conversion and the two ceilings coincide there.
// Converted once, from the budget the documents are actually measured against. Converting the
// ceiling and the headroom separately and subtracting would agree with this only by rounding
// coincidence, so a constant bump that touched no document at all could fail the equality below.
const EFFECTIVE_CEILING_TOKENS = cost_tokens.ascii_bytes_to_tokens(EFFECTIVE_CEILING_BYTES)

// A symbol rather than a letter, so a long run of it is not a word the spell check has to know.
const TWO_BYTE_CHAR = '±'
const THREE_BYTE_CHAR_BYTES = 3

const KICKOFF_FILE = 'kickoff.md'
const FULLRUN_FILE = 'fullrun.md'
// joshuafolkken/kit#2189 turned `fullrun.md` into a manifest and moved its step lists — the stash of a
// `fullrun new`'s pre-existing changes among them — to `fullrun-steps.md`, so the stash-safety check
// below reads that companion for the `fullrun` side.
const FULLRUN_STEPS_FILE = 'fullrun-steps.md'
const HALFRUN_FILE = 'halfrun.md'
const CHAIN_RULE_FILE = 'chain-rule.md'
const FOLLOWUP_FILE = 'followup.md'
const ANTI_PATTERN_MARKER = '**Anti-pattern catalog**'

// The headings of the two sections that stayed resident. `ROUTING_END_HEADING` doubles as the
// marker for the rule that cannot move — it is the first thing after the routing table.
//
// All three were asserted by a suite that compared these sections byte-for-byte across the three
// paired documents. joshuafolkken/kit#963 single-sourced the rules, so there is nothing left to
// compare a document against and that suite is gone. What it was really protecting is that these
// sections exist and are resident, which is asserted directly below instead — the substance of each
// one is already pinned marker by marker, and without the headings a rename would go unnoticed.
const ROUTING_HEADING = '### Shorthand Commands'
const ROUTING_END_HEADING = '#### Explicit invocation required (MANDATORY)'
// joshuafolkken/kit#3395 retired the overrides section: its two prohibitions are one Tier C entry in
// "Decision autonomy", and the procedure is the `dependency-update` skill.
const OVERRIDES_HEADING = '### Dependency overrides (`pnpm-workspace.yaml` / `package.json`)'
// Pinned in its own right: it was only ever asserted as the end of the overrides slice, so deleting
// the slice comparison took the one assertion that `## Package-First Development` still exists.
const PACKAGE_FIRST_HEADING = '## Package-First Development'

const SUPPORTING_FILES: ReadonlyArray<string> = [
	KICKOFF_FILE,
	FULLRUN_FILE,
	HALFRUN_FILE,
	CHAIN_RULE_FILE,
	FOLLOWUP_FILE,
]

function basename_of(file_path: string): string {
	return file_path.split('/').at(-1) ?? file_path
}

// Every skill directory in this repository, so the distribution check covers all of them.
function distributed_skill_directories(): Array<string> {
	return readdirSync(package_file(SKILL_ROOT), { withFileTypes: true })
		.filter((entry) => entry.isDirectory())
		.map((entry) => `${SKILL_ROOT}/${entry.name}`)
		.toSorted((left, right) => left.localeCompare(right))
}

// Enumerated from disk rather than listed here: every skill in the repository now ships to consumers
// as the `kit` Claude Code plugin (joshuafolkken/kit#1879), auto-discovered from the package's
// `.claude/skills` directory, so none is copied into a consumer's tree and a skill added and
// forgotten cannot reach a consumer as a pointer to a file they do not have.
describe.each(distributed_skill_directories())('%s — distribution', (skill_directory) => {
	const content = read_skill_file(skill_directory)

	it('ships as the kit plugin rather than a copied directory', () => {
		expect(init_logic.get_ai_copy_directories()).not.toContain(skill_directory)
	})

	it('opens with YAML frontmatter Claude Code can read', () => {
		expect(skill_meta.has_frontmatter(content)).toBe(true)
	})

	it('declares a name matching its directory', () => {
		expect(skill_meta.frontmatter_of(content)).toContain(`name: ${basename_of(skill_directory)}`)
	})

	it('declares a description that says when to read it', () => {
		expect(skill_meta.description_of(content).length).toBeGreaterThan(MINIMUM_DESCRIPTION_LENGTH)
	})
})

describe(`${WORKFLOW_SKILL} — carries the procedures that left the documents`, () => {
	const entry = read_skill_file(WORKFLOW_SKILL)

	it.each(SUPPORTING_FILES)('routes to %s from the entry file', (filename) => {
		expect(entry).toContain(filename)
	})

	// Every shipped file being reachable from the entry is pinned in `workflow-skill-reach.test.ts`.

	// The stop rule itself is resident (asserted below); what the entry file owes the reader is the
	// pointer, since `kickoff` and `halfrun` are routed away from `followup.md`.
	it('points at the resident mid-workflow stop rule', () => {
		expect(entry).toContain('Mid-workflow stop notification')
	})

	// joshuafolkken/kit#2296: `chain-rule.md` is how the gate itself starts, overlapped with the review,
	// so a run that read it before the `/code-review` step had already run the gate bare. Its point-of-use
	// trigger names the first gate launch instead.
	it('reads chain-rule.md before the first gate launch, not before the review', () => {
		expect(entry).toContain('Before the first `pnpm josh gate` launch')
	})

	// A command that stashes the working tree and never pops it leaves the user's changes buried in
	// the stash list with the run reporting success. The pop is `pnpm josh stash:pop`, targeted by
	// message, because the stash is a repository-wide stack every lane shares — a positional
	// `git stash pop` takes whichever lane last pushed (joshuafolkken/kit#2050).
	it.each([FULLRUN_STEPS_FILE, HALFRUN_FILE])('%s restores everything it stashes', (filename) => {
		const content = read_skill_file(WORKFLOW_SKILL, filename)

		expect(content).toContain('git stash push')
		expect(content).toContain('pnpm josh stash:pop')
	})

	// The comment-reading step every `#N` entry point owes is pinned by its own suite, beside the two
	// other delivered rules: `scripts/rules/issue-comments-rule.test.ts` (joshuafolkken/kit#1319).
	it.each([
		[FULLRUN_FILE, 'pnpm josh followup'],
		[HALFRUN_FILE, '**Invoking `halfrun` is _not_ authorization to commit, push, or merge**'],
		[KICKOFF_FILE, 'pnpm josh epic'],
		[CHAIN_RULE_FILE, 'Run the review-to-merge chain'],
		[FOLLOWUP_FILE, '`auto-merge` — Default `fullrun` behavior'],
	])('%s states %j', (filename, marker) => {
		expect(read_skill_file(WORKFLOW_SKILL, filename)).toContain(marker)
	})
})

describe(`${DEPENDENCY_SKILL} — carries the post-update verification`, () => {
	const content = read_skill_file(DEPENDENCY_SKILL)

	it.each([
		'git diff -- pnpm-workspace.yaml package.json',
		'**pnpm 11 and 12 read effective overrides only from `pnpm-workspace.yaml`.**',
		'**quote what one printed.**',
		'the `josh latest` lockstep pnpm bump is expected, NOT a violation',
		'never touch `overrides`',
		'never touch `devEngines`',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// joshuafolkken/kit#951: what may stay resident had never been written down, so each new rule was
// placed by whoever wrote it. The criterion has one input — does the rule bind before a command has
// started — and every rule that passes it is named, because a criterion with no worked examples is
// re-derived differently every time it is applied.
describe('the residency criterion — which rules may stay in the always-loaded documents', () => {
	// §3's heading stays in the entry file as a pointer (pinned in `document-markers.test.ts`), but its
	// whole body — the residency questions included — left it (joshuafolkken/kit#1797,
	// joshuafolkken/kit#2161), and joshuafolkken/kit#2891 merged the skill-side copy into the canonical
	// topic file, so the criterion is asserted at its one home.
	it('states the residency criterion at its single source', () => {
		expect(read_unwrapped(RESIDENCY_TOPIC)).toContain(
			'**`CLAUDE.md` に残るのは、skill がロードされていないターンでも効く必要がある規則だけである。**',
		)
	})
})

// joshuafolkken/kit#955: written without a scope, the exhaustiveness claim read as governing every
// resident rule — naming conventions and quality limits included — which would either grow the list
// without end or mark them as unchecked candidates for a skill. Counting by skill instead drew the
// line in two wrong places at once: `verify-ui` is routed to just as this skill is, and one entry
// routes to a prompt rather than to a skill at all. The axis is whether the rule has a counterpart.
describe('the residency list says what it covers', () => {
	// joshuafolkken/kit#2891 merged the English skill-side copy of this list into the canonical topic
	// file, and joshuafolkken/kit#3177 moved it on to the rationale, in English again.
	it.each([
		'Within that scope the list is exhaustive',
		// The pointer has to name where each entry is actually guarded; two of them are asserted by their
		// own suites, and a maintainer who looks only in this one concludes they are unguarded.
		'the UI verification gate in `scripts/claude/verify-ui-skill.test.ts`',
		'Absence from the list is not an omission',
		// The worked examples §3 used to carry (joshuafolkken/kit#1797); joshuafolkken/kit#3395 moved the
		// `epic:*` rules off residency, and the list records where they went.
		'**Explicit invocation required**',
		'**The `confirmation` notification on a stop**',
		'**`overrides` protection**',
		'**Moved off residency by joshuafolkken/kit#3395.**',
		NOT_ASPIRATIONAL_MARKER,
	])('scopes the claim at the single source: %j', (marker) => {
		expect(read_unwrapped(RESIDENCY_RATIONALE)).toContain(marker)
	})

	// Asserted absent, not merely replaced: the unscoped sentence beside the scoped one leaves two
	// claims about the same list, and a reader applying the first one still grows it without end.
	it('no longer claims the list covers every resident rule', () => {
		expect(read_unwrapped(WORKFLOW_PROMPT)).not.toContain('**この一覧は網羅的である**')
	})

	// The skill is the operational copy; the canonical reference is where the rule is argued, and the
	// two have to agree. A criterion stated only in the skill is invisible to a Gemini or Cursor run,
	// which reads the prompt and never loads a Claude Code skill.
	it.each([
		'## 常駐ドキュメントと skill の分担（何を常駐に残すか）',
		'**その規則は、skill がロードされていないターンでも効く必要があるか。**',
	])('is argued in the canonical prompt: %j', (marker) => {
		expect(read_unwrapped(WORKFLOW_PROMPT)).toContain(marker)
	})

	it.each([
		'**This list covers the resident rules that have a procedure on the on-demand side**',
		'**Drawing the line by counting skills is wrong**',
		'**The UI verification gate**',
		'**A resident rule outside that scope is correctly absent from this list.**',
	])('keeps the list argued in the rationale: %j', (marker) => {
		expect(read_unwrapped(RESIDENCY_RATIONALE)).toContain(marker)
	})
})

// joshuafolkken/kit#1275: "do not raise the ceiling" was written as a flat prohibition, so on the
// day recovery genuinely runs out there is no procedure for moving it and the cheapest move left is
// deleting an unpinned sentence — the failure this whole criterion exists to prevent. The conditions
// that would justify a raise are now written down, and pinned so they survive the
// joshuafolkken/kit#1193 consistency sweep.
describe('the ceiling can be raised, but only against written conditions', () => {
	it.each([
		'**引き上げは Tier C として扱う**',
		// The Tier C half protects the budget by naming its constants, so a rename made here and not
		// there leaves the rule guarding a name nothing uses. All three are named because whichever
		// one is actually binding is the one somebody will want to loosen.
		'RESIDENT_CEILING_BYTES',
		'RESIDENT_HEADROOM_BYTES',
		'RE_INLINE_GUARD_HEADROOM_BYTES',
	])('states the rule for raising the ceiling: %j', (marker) => {
		expect(read_unwrapped(RESIDENCY_TOPIC)).toContain(marker)
	})

	// The conditions themselves moved to the rationale in joshuafolkken/kit#3177; the topic file keeps
	// the Tier C line and points at them.
	it.each([
		'## When the ceiling may be raised',
		'**"Do not raise" is a falsifiable default, not an absolute prohibition.**',
		'**Exhaustion is shown by measurement, not asserted**',
		'**The risk is asymmetric, so when in doubt, recover.**',
		'**A raise is Tier C.**',
		'RE_INLINE_GUARD_HEADROOM_BYTES',
	])('records the raise conditions in the rationale: %j', (marker) => {
		expect(read_unwrapped(RESIDENCY_RATIONALE)).toContain(marker)
	})
})

describe.each(AI_DOCS)('%s — stays inside the resident budget', (document_path) => {
	const content = read_repo_file(document_path)

	// joshuafolkken/kit#1275: this used to assert only `< EFFECTIVE_CEILING_BYTES`, and it passed at
	// 30 bytes of headroom — the state the reserve exists to prevent rather than the state it
	// permits, since the next resident rule then pays for itself out of whichever neighboring
	// sentence no marker pinned. The guard floor is asserted in its place rather than beside it:
	// being over the ceiling is being under the floor as well, so a second assertion could never
	// fail on its own, and two tests for one condition report the same defect twice.
	it('stays under the resident ceiling, with room left to write the next rule', () => {
		const headroom = EFFECTIVE_CEILING_BYTES - Buffer.byteLength(content, 'utf8')

		expect(headroom).toBeGreaterThan(RE_INLINE_GUARD_HEADROOM_BYTES)
	})

	// The same budget read in the unit the bill arrives in. It is not a second, looser guard: for
	// ASCII it fails on exactly the same edit the byte assertion does, and for anything denser it
	// fails earlier — which is the case the byte budget cannot see.
	//
	// The guard floor is converted rather than reused as a byte count, for the reason the ceiling
	// itself is: reserving 1,000 *tokens* would be reserving three times the bytes. Held only in
	// bytes, the reserve would not exist in this unit at all, and a wide-character-dense document
	// could pass here at one token of margin — the zero-headroom state joshuafolkken/kit#1275 exists
	// to prevent, reached through the door the byte assertion cannot see.
	it('stays under the resident ceiling measured in tokens', () => {
		const headroom = EFFECTIVE_CEILING_TOKENS - cost_tokens.estimate(content)

		expect(headroom).toBeGreaterThan(
			cost_tokens.ascii_bytes_to_tokens(RE_INLINE_GUARD_HEADROOM_BYTES),
		)
	})
})

describe.each(AI_DOCS)('%s — routes to the skills instead of inlining them', (document_path) => {
	const content = read_repo_file(document_path)

	// The skills now ship as the `kit` plugin (joshuafolkken/kit#1879), so the document routes to them
	// by skill name rather than by a `.claude/skills/…` path that would not resolve at a consumer.
	it.each(['workflow-commands', 'dependency-update'])('names the %s skill', (skill_name) => {
		expect(content).toContain(`\`${skill_name}\` skill`)
	})

	// Asserted absent, not merely "not required": a document that both routes to the skill and keeps
	// the procedure has not been split, and the two copies drift from the next edit onward.
	it.each([
		'#### `kickoff` — Planning phase only',
		'#### `fullrun` — Full execution',
		'#### `halfrun` — Implement + verify',
		'#### `/review` → `followup` chain rule (MANDATORY)',
		ANTI_PATTERN_MARKER,
		// joshuafolkken/kit#951: three rules that bind only after a command has started, restated
		// resident until the documents reached the ceiling. Their opening sentences are pinned absent
		// so a re-inlining is caught by name rather than only by the byte count it would push past.
		'**The split assessment runs at every entry point, from one definition.**',
		'**A prerequisite discovered mid-run is a dependency, not a park.**',
		'**`epicrun` also accepts an Issue that is not an epic.**',
		'**`epicrun` parks instead of stopping.**',
		// joshuafolkken/kit#3077: the routing paragraph for the same three rules went too — the table's
		// "Read first" column already names `split-assessment.md` for every entry.
		'**Three rules decide what a run does when the work turns out not to be one Issue**',
	])('no longer inlines %j', (marker) => {
		expect(content).not.toContain(marker)
	})

	// Removing a procedure is only half of it. Without the routing the rule reaches no run at all,
	// which reads exactly like the rule having been deleted. joshuafolkken/kit#3171 dropped the per-command
	// "Read first" table — the skill's own §1 is that table — so the routing is the one sentence that
	// sends every command to the skill before its first call.
	it.each([
		'procedures in the `workflow-commands` skill',
		'read it before any part of a command, including the first `gh` call',
	])('routes to the moved procedures with %j', (marker) => {
		expect(content).toContain(marker)
	})

	// joshuafolkken/kit#1985 removed `epicrun` and kept a resident redirect for a typed old keyword.
	// joshuafolkken/kit#3395 retired the redirect with the rest of the per-task prose; the history keeps
	// it in docs/maintainers/claude-md-history.md.
	it('no longer carries the retired-keyword redirect', () => {
		expect(content).not.toContain('**`queue` and `epicrun` were removed**')
	})
})

// The rules that pass the residency criterion: each one binds on a turn where the workflow skill was
// never loaded — the first decides whether a workflow starts at all, and the pauses that need the
// second mostly happen with no workflow keyword typed (an upstream-Issue interrupt, a Tier C stop).
describe.each(AI_DOCS)('%s — keeps what cannot move', (document_path) => {
	const content = read_repo_file(document_path)

	it.each([
		ROUTING_HEADING,
		ROUTING_END_HEADING,
		PACKAGE_FIRST_HEADING,
		'Please run \\`<command>\\` to start this task.',
		'pnpm josh notify --task-type confirmation',
		// joshuafolkken/kit#3395: both prohibitions of the retired overrides section, as one Tier C
		// entry. The sanctioned `josh latest` bump is named by the `dependency-update` skill, and the
		// `epic:*` rules by the `epic-commands` skill, whose description carries their trigger.
		'`devEngines` / overrides edits): explicit user instruction only',
		// Clearing `needs-decision` moved into that skill, so recording a decision has to load it, or
		// the label stays and the child is parked out of the backlog pool.
		'when recording a decision on a `needs-decision` child',
	])('keeps %j resident', (marker) => {
		expect(content).toContain(marker)
	})

	it('no longer carries the overrides section', () => {
		expect(content).not.toContain(OVERRIDES_HEADING)
	})

	// joshuafolkken/kit#3077: the merge exception named `fullrun` alone, though a `backlogrun` merges
	// too and a `prrun` stops before the merge. The exception is resident because it binds the merge
	// itself, which a turn can reach without the skill loaded.
	it.each(['invoking `fullrun` or `backlogrun` authorizes the merge', '`prrun` does not'])(
		'states the merge exception with %j',
		(marker) => {
			expect(content).toContain(marker)
		},
	)

	// The residency criterion itself is not restated here: it lives in `residency.md` (question 2) and
	// is read only when a rule is placed (joshuafolkken/kit#3256). The markers above pin its outcome.
})

// joshuafolkken/kit#964: the residency criterion decides *whether* a rule stays; this is the guard
// on *how much* of it stays. A rule that cites a canonical section has its procedure there, so the
// resident text is a trigger and a pointer — and a trigger that grew past this cap has had its
// procedure pasted back beside the pointer, which is how `CLAUDE.md` reached 585 bytes of headroom
// with the procedures already moved out.
//
// The cap is not a style preference. It is set just above the largest rule that legitimately needs
// most of its text resident — the cross-package interrupt, whose every sentence changes what an
// agent does rather than how well it understands why. Anything larger is procedure.
const RESIDENT_RULE_CAP_BYTES = 2600
// joshuafolkken/kit#965 split the canonical into one file per topic, so a resident rule now cites
// the topic file rather than the index plus a section name.
const CANONICAL_CITATION = 'prompts/collaboration-workflow/'
// Leading whitespace is allowed: several resident rules are sub-bullets under a heading, and an
// anchored pattern would have exempted exactly the rules that are easiest to grow unnoticed.
const RULE_BULLET_PATTERN = /^\s*- \*\*(.+?)\*\*/u

interface ResidentRule {
	title: string
	body: string
}

// Every `- **…**` rule in the document, wherever it sits. Scoping this to one section would leave
// the rules in `## Git Rules` and `## Collaboration Workflow` free to grow a second copy of their
// procedure beside the pointer — which is the regression the cap exists to stop, so the cap has to
// see them. Each rule is a single line: prettier runs with `proseWrap: preserve` here, so the line
// is the rule. Matching line by line also avoided materializing a match iterator, which
// `prefer-spread` and `prefer-iterator-to-array` used to disagree about how to spell —
// joshuafolkken/kit#1783 settled that, so only the first reason is load-bearing now.
function resident_rules(content: string): ReadonlyArray<ResidentRule> {
	return content
		.split('\n')
		.map((line) => ({ line, matched: RULE_BULLET_PATTERN.exec(line) }))
		.filter((entry) => entry.matched !== null)
		.map((entry) => ({ title: entry.matched?.[1] ?? '', body: entry.line }))
}

describe.each(AI_DOCS)('%s — a resident rule is a trigger and a pointer', (document_path) => {
	const rules = resident_rules(read_repo_file(document_path)).filter((rule) =>
		rule.body.includes(CANONICAL_CITATION),
	)

	it('has rules that cite a canonical section at all', () => {
		expect(rules.length).toBeGreaterThan(0)
	})

	it.each(rules.map((rule) => [rule.title, rule.body] as const))(
		'%s stays a trigger rather than a second copy of its procedure',
		(_title, body) => {
			expect(Buffer.byteLength(body, 'utf8')).toBeLessThan(RESIDENT_RULE_CAP_BYTES)
		},
	)
})

// joshuafolkken/kit#1151. Without this the two ceilings are two numbers a later edit can move apart,
// and the pair then disagrees about the same document — which is the state "hold the budget in
// tokens as well" was meant to remove, not create.
describe('the resident budget reads the same in both units', () => {
	// The property that makes them one limit rather than two: an ASCII document that exactly fills
	// the byte budget exactly fills the token budget.
	it('puts an ASCII document at the same point in each budget', () => {
		const document = 'a'.repeat(EFFECTIVE_CEILING_BYTES)

		expect(Buffer.byteLength(document, 'utf8')).toBe(EFFECTIVE_CEILING_BYTES)
		expect(cost_tokens.estimate(document)).toBe(EFFECTIVE_CEILING_TOKENS)
	})

	// Where the two units genuinely disagree: a two-byte character costs a whole token, so half the
	// byte budget spent on one is already the whole token budget. The byte ceiling cannot see this.
	it('catches two-byte content the byte ceiling would pass', () => {
		const dense = TWO_BYTE_CHAR.repeat(EFFECTIVE_CEILING_TOKENS)

		expect(Buffer.byteLength(dense, 'utf8')).toBeLessThan(EFFECTIVE_CEILING_BYTES)
		expect(cost_tokens.estimate(dense)).toBeGreaterThanOrEqual(EFFECTIVE_CEILING_TOKENS)
	})

	// And where they do not: Japanese is three bytes per character and one token, which is exactly
	// the conversion, so the two ceilings land on the same document. Asserted so the pair is not
	// later described as the stricter guard it is not.
	it('agrees with the byte ceiling on three-byte content', () => {
		const japanese = 'あ'.repeat(EFFECTIVE_CEILING_TOKENS)
		const short_by = EFFECTIVE_CEILING_BYTES - Buffer.byteLength(japanese, 'utf8')

		expect(short_by).toBeLessThan(THREE_BYTE_CHAR_BYTES)
		expect(cost_tokens.estimate(japanese)).toBe(EFFECTIVE_CEILING_TOKENS)
	})
})

describe('the residency criterion defines how much of a resident rule is resident', () => {
	const criterion = read_unwrapped(RESIDENCY_TOPIC)

	it.each([
		'**常駐規則は、トリガと導線の 2 つで書く。**',
		'**判定は、導線を一度も開かないターンでも常駐の記述だけで正しく振る舞えるかである。**',
		// Re-pointed by joshuafolkken/kit#1525: trimming is still moving, but a narrow retirement
		// route now exists beside it, so the sentence that used to close the door names the exception.
		'**削ることは移すことであり、削除は理由を示して初めて許される例外である。**',
	])('states %j', (marker) => {
		expect(criterion).toContain(marker)
	})
})

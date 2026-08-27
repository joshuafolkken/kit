import { readdirSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
	AI_DOCS,
	read_repo_file,
	read_unwrapped,
	skill_documents,
	WORKFLOW_PROMPT,
} from './ai-document-fixture'
import { init_logic } from './init/init-logic'
import {
	has_frontmatter,
	package_file,
	read_skill_file,
	skill_description,
	SKILL_ENTRY_FILE,
	skill_frontmatter,
	SKILL_ROOT,
} from './skill-fixture'

// joshuafolkken/kit#854: the three AI documents are read in full on every turn, and roughly half of
// each was procedure for a workflow most turns never enter. Those sections now live in skills the
// documents route to. The split only holds if three things are true together — the skills ship, the
// documents route to them, and the prohibitions that have to fire *before* a skill is loaded stay
// resident — so all three are asserted here rather than left to the section that moved.
const WORKFLOW_SKILL = '.claude/skills/workflow-commands'
const DEPENDENCY_SKILL = '.claude/skills/dependency-update'

// Long enough that it says when to read the skill rather than merely naming it — the description is
// what an agent matches the situation against, so a one-liner ships a skill nothing ever opens.
const MINIMUM_DESCRIPTION_LENGTH = 80

// The documents sat at ~83 KB each before the split and ~49 KB after. The ceiling is deliberately
// slack: it is a guard against a procedure being inlined back into the always-loaded surface, not a
// budget anyone should tune prose against.
const RESIDENT_CEILING_BYTES = 60_000

// joshuafolkken/kit#951: the ceiling alone stops the wrong thing. Reached, it does not block the
// next rule — it makes that rule pay for itself by deleting a neighboring sentence, and the
// sentence chosen is whichever one no marker pinned rather than whichever one matters least. A
// required margin turns "at the limit" into a failure while there is still room to write the fix,
// which is the only point at which moving a procedure into a skill is still a choice.
const RESIDENT_HEADROOM_BYTES = 2000

const KICKOFF_FILE = 'kickoff.md'
const FULLRUN_FILE = 'fullrun.md'
const HALFRUN_FILE = 'halfrun.md'
const QUEUE_FILE = 'queue.md'
const CHAIN_RULE_FILE = 'chain-rule.md'
const FOLLOWUP_FILE = 'followup.md'
const ANTI_PATTERN_MARKER = '**Anti-pattern catalog**'

// The headings that bound the two sections which stayed resident. `ROUTING_END_HEADING` doubles as
// the marker for the rule that cannot move — it is the first thing after the routing table.
const ROUTING_HEADING = '### Shorthand Commands'
const ROUTING_END_HEADING = '#### Explicit invocation required (MANDATORY)'
const OVERRIDES_HEADING = '### Dependency overrides (`pnpm-workspace.yaml` / `package.json`)'
const OVERRIDES_END_HEADING = '## Package-First Development'

const SUPPORTING_FILES: ReadonlyArray<string> = [
	KICKOFF_FILE,
	FULLRUN_FILE,
	HALFRUN_FILE,
	QUEUE_FILE,
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

// Enumerated from disk rather than listed here: a skill added to the repository and forgotten in
// `AI_COPY_DIRECTORIES` reaches consumers as a pointer to a file they do not have, and a hardcoded
// list is exactly what let that happen (joshuafolkken/kit#873).
describe.each(distributed_skill_directories())('%s — distribution', (skill_directory) => {
	const content = read_skill_file(skill_directory)

	it('is copied into consumers as a directory', () => {
		expect(init_logic.get_ai_copy_directories()).toContain(skill_directory)
	})

	it('opens with YAML frontmatter Claude Code can read', () => {
		expect(has_frontmatter(content)).toBe(true)
	})

	it('declares a name matching its directory', () => {
		expect(skill_frontmatter(content)).toContain(`name: ${basename_of(skill_directory)}`)
	})

	it('declares a description that says when to read it', () => {
		expect(skill_description(content).length).toBeGreaterThan(MINIMUM_DESCRIPTION_LENGTH)
	})
})

describe(`${WORKFLOW_SKILL} — carries the procedures that left the documents`, () => {
	const entry = read_skill_file(WORKFLOW_SKILL)

	it.each(SUPPORTING_FILES)('routes to %s from the entry file', (filename) => {
		expect(entry).toContain(filename)
	})

	// A supporting file the entry never names is a file no run opens — the skill would ship the rule
	// and still behave as though it had been deleted.
	it('names every markdown file it ships', () => {
		const supporting = skill_documents()
			.filter((path) => path.startsWith(`${WORKFLOW_SKILL}/`) && !path.endsWith(SKILL_ENTRY_FILE))
			.map((path) => basename_of(path))

		for (const filename of supporting) expect(entry).toContain(filename)
	})

	// The stop rule itself is resident (asserted below); what the entry file owes the reader is the
	// pointer, since `kickoff` and `halfrun` are routed away from `followup.md`.
	it('points at the resident mid-workflow stop rule', () => {
		expect(entry).toContain('Mid-workflow stop notification')
	})

	// A command that stashes the working tree and never pops it leaves the user's changes buried in
	// the stash list with the run reporting success.
	it.each([FULLRUN_FILE, HALFRUN_FILE, QUEUE_FILE])(
		'%s restores everything it stashes',
		(filename) => {
			const content = read_skill_file(WORKFLOW_SKILL, filename)

			expect(content).toContain('git stash')
			expect(content).toContain('git stash pop')
		},
	)

	it.each([
		[FULLRUN_FILE, 'pnpm josh followup'],
		[HALFRUN_FILE, '**Invoking `halfrun` is _not_ authorization to commit, push, or merge**'],
		[QUEUE_FILE, 'stop immediately'],
		[KICKOFF_FILE, 'pnpm josh epic'],
		[CHAIN_RULE_FILE, ANTI_PATTERN_MARKER],
		[CHAIN_RULE_FILE, 'Turn-end self-check'],
		[FOLLOWUP_FILE, '`auto-merge` — Default `fullrun` behavior'],
	])('%s states %j', (filename, marker) => {
		expect(read_skill_file(WORKFLOW_SKILL, filename)).toContain(marker)
	})
})

describe(`${DEPENDENCY_SKILL} — carries the post-update verification`, () => {
	const content = read_skill_file(DEPENDENCY_SKILL)

	it.each([
		'git diff -- pnpm-workspace.yaml package.json',
		"**Overrides live in two files, and one of them alone is not the project's answer.**",
		'quote what one of them printed rather than a verdict you inferred',
		'the `josh latest` lockstep pnpm bump is expected, NOT a violation',
	])('states %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// joshuafolkken/kit#951: what may stay resident had never been written down, so each new rule was
// placed by whoever wrote it. The criterion has one input — does the rule bind before a command has
// started — and every rule that passes it is named, because a criterion with no worked examples is
// re-derived differently every time it is applied.
describe('the residency criterion — which rules may stay in the always-loaded documents', () => {
	// Enumerated, because a criterion with no worked examples is re-derived differently each time, and
	// the set has to match what the suite below asserts resident.
	it.each([
		'## 3. What stays resident, and what is read from here',
		'**A rule stays in the AI documents if and only if it has to fire on a turn where no skill was loaded.**',
		'**Explicit invocation required**',
		'**The mid-workflow stop notification**',
		'**The `overrides` prohibition**',
		'**The UI-verification gate**',
		'**The three `josh epic:*` rules that bind outside those commands**',
		'**The criterion is not advisory.**',
	])('is documented in the workflow skill: %j', (marker) => {
		expect(read_unwrapped(`${WORKFLOW_SKILL}/${SKILL_ENTRY_FILE}`)).toContain(marker)
	})
})

// joshuafolkken/kit#955: written without a scope, the exhaustiveness claim read as governing every
// resident rule — naming conventions and quality limits included — which would either grow the list
// without end or mark them as unchecked candidates for a skill. Counting by skill instead drew the
// line in two wrong places at once: `verify-ui` is routed to just as this skill is, and one entry
// routes to a prompt rather than to a skill at all. The axis is whether the rule has a counterpart.
describe('the residency list says what it covers', () => {
	it.each([
		'**The scope of this list is every resident rule that has an on-demand counterpart**',
		'Within that scope the list is exhaustive',
		'Counting by skill would draw the line in the wrong place',
		// The pointer has to name where each entry is actually guarded; two of them are asserted by their
		// own suites, and a maintainer who looks only in this one concludes they are unguarded.
		'`scripts/verify-ui-skill.test.ts` for the UI gate',
		'**None of that belongs on this list**',
		'their absence here is correct rather than an omission',
	])('scopes the claim in the workflow skill: %j', (marker) => {
		expect(read_unwrapped(`${WORKFLOW_SKILL}/${SKILL_ENTRY_FILE}`)).toContain(marker)
	})

	// Asserted absent, not merely replaced: the unscoped sentence beside the scoped one leaves two
	// claims about the same list, and a reader applying the first one still grows it without end.
	it('no longer claims the list covers every resident rule', () => {
		expect(read_unwrapped(`${WORKFLOW_SKILL}/${SKILL_ENTRY_FILE}`)).not.toContain(
			'The list is exhaustive — a rule added to the documents',
		)
		expect(read_unwrapped(WORKFLOW_PROMPT)).not.toContain('**この一覧は網羅的である**')
	})

	// The skill is the operational copy; the canonical reference is where the rule is argued, and the
	// two have to agree. A criterion stated only in the skill is invisible to a Gemini or Cursor run,
	// which reads the prompt and never loads a Claude Code skill.
	it.each([
		'## 常駐ドキュメントと skill の分担（何を常駐に残すか）',
		'**その規則は、skill がロードされていないターンでも効く必要があるか。**',
		'**この基準は努力目標ではない。**',
		'**この一覧の対象範囲は、オンデマンド側に対応する手順を持つ常駐規則である**',
		'**skill の数で線を引くのは誤りである**',
		'**UI 検証ゲート**',
		'**範囲の外にある常駐規則はこの一覧に載らないのが正常である。**',
	])('is argued in the canonical prompt: %j', (marker) => {
		expect(read_unwrapped(WORKFLOW_PROMPT)).toContain(marker)
	})
})

describe.each(AI_DOCS)('%s — routes to the skills instead of inlining them', (document_path) => {
	const content = read_repo_file(document_path)

	it('stays under the resident ceiling, with room left to write the next rule', () => {
		expect(Buffer.byteLength(content, 'utf8')).toBeLessThan(
			RESIDENT_CEILING_BYTES - RESIDENT_HEADROOM_BYTES,
		)
	})

	it.each([WORKFLOW_SKILL, DEPENDENCY_SKILL])('names %s', (skill_directory) => {
		expect(content).toContain(skill_directory)
	})

	// Asserted absent, not merely "not required": a document that both routes to the skill and keeps
	// the procedure has not been split, and the two copies drift from the next edit onward.
	it.each([
		'#### `kickoff` — Planning phase only',
		'#### `fullrun` — Full execution',
		'#### `halfrun` — Implement + verify',
		'#### `queue` — Sequential multi-issue fullrun',
		'#### `/review` → `followup --merge` chain rule (MANDATORY)',
		ANTI_PATTERN_MARKER,
		// joshuafolkken/kit#951: three rules that bind only after a command has started, restated
		// resident until the documents reached the ceiling. Their opening sentences are pinned absent
		// so a re-inlining is caught by name rather than only by the byte count it would push past.
		'**The split assessment runs at every entry point, from one definition.**',
		'**A prerequisite discovered mid-run is a dependency, not a park.**',
		'**`epicrun` also accepts an Issue that is not an epic.**',
		'**`epicrun` parks instead of stopping.**',
	])('no longer inlines %j', (marker) => {
		expect(content).not.toContain(marker)
	})

	// Removing a procedure is only half of it. Without the routing the rule reaches no run at all,
	// which reads exactly like the rule having been deleted.
	it.each([
		'**Three rules decide what a run does when the work turns out not to be one Issue**',
		'split-assessment.md',
		'`fullrun.md` / `halfrun.md` / `epicrun.md`',
		'**`epicrun` parks a child instead of stopping the session**',
	])('routes to the moved procedures with %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// The rules that pass the residency criterion: each one binds on a turn where the workflow skill was
// never loaded — the first decides whether a workflow starts at all, and the pauses that need the
// second mostly happen with no workflow keyword typed (an upstream-Issue interrupt, a Tier C stop).
describe.each(AI_DOCS)('%s — keeps what cannot move', (document_path) => {
	const content = read_repo_file(document_path)

	it.each([
		ROUTING_END_HEADING,
		'Please run \\`<command>\\` to start this task.',
		'pnpm josh notify --task-type confirmation',
		'`parseArgs` rejects it',
		'**NEVER** remove or modify entries in **either** location without explicit user approval.',
		'**NEVER** modify the `devEngines` field in `package.json` without explicit user confirmation.',
		// The three `epic:*` rules the criterion's list names. They fire the moment an issue is filed
		// or a decision is written, on turns where no `epic:*` command was run.
		"recording a decision removes that child's `needs-decision` label",
		'**fixing what the audit finds is Tier A**',
		'**an epic in another repository is referenced as `owner/repo#N`**',
	])('keeps %j resident', (marker) => {
		expect(content).toContain(marker)
	})

	// The criterion itself is what keeps the next rule from landing resident by default. It is stated
	// in full in the skill; what the documents carry is the question.
	// Both halves are pinned: the question, and the set it resolves to. A criterion whose worked
	// examples drift from what this suite asserts resident is what let the rule be applied two ways
	// at once (joshuafolkken/kit#951).
	it.each([
		'**What stays here is decided by one question: must the rule fire on a turn where no skill was loaded?**',
		'Explicit invocation, the mid-workflow stop notification, the `overrides` / `devEngines` prohibitions, the UI-verification gate and the three `epic:*` rules below all do',
	])('states the test for what may stay resident: %j', (marker) => {
		expect(content).toContain(marker)
	})
})

// kit#854 traded per-document assertions of the moved rules for one shared copy in the skills, which
// is what `read_rule_surface` reflects: a marker that lives only in a skill now passes for all three
// documents, so those suites no longer catch a document that fell behind. What still has to be
// checked per document is the part that stayed resident — the routing itself. These slices are
// inserted identically into all three, so comparing them restores the drift detection the surface
// gave up, at the level where drift is still possible.

function section_of(content: string, heading: string, end_heading: string): string {
	const start = content.indexOf(heading)
	const end = content.indexOf(end_heading, start)

	expect(start).toBeGreaterThan(-1)
	expect(end).toBeGreaterThan(start)

	return content.slice(start, end).trim()
}

describe('routing sections are identical across the paired documents', () => {
	const reference = read_repo_file(AI_DOCS[0] ?? '')

	it.each([
		['workflow routing', ROUTING_HEADING, ROUTING_END_HEADING],
		['overrides routing', OVERRIDES_HEADING, OVERRIDES_END_HEADING],
	])('%s reads the same in every document', (_label, heading, end_heading) => {
		const expected = section_of(reference, heading, end_heading)

		for (const document_path of AI_DOCS) {
			expect(section_of(read_repo_file(document_path), heading, end_heading)).toBe(expected)
		}
	})
})

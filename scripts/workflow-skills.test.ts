import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file, skill_documents } from './ai-document-fixture'
import { init_logic } from './init/init-logic'
import {
	has_frontmatter,
	read_skill_file,
	skill_description,
	SKILL_ENTRY_FILE,
	skill_frontmatter,
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

describe.each([WORKFLOW_SKILL, DEPENDENCY_SKILL])('%s — distribution', (skill_directory) => {
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

describe.each(AI_DOCS)('%s — routes to the skills instead of inlining them', (document_path) => {
	const content = read_repo_file(document_path)

	it('stays under the resident ceiling', () => {
		expect(Buffer.byteLength(content, 'utf8')).toBeLessThan(RESIDENT_CEILING_BYTES)
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
	])('no longer inlines %j', (marker) => {
		expect(content).not.toContain(marker)
	})

	// The one rule that cannot move: it decides whether a workflow starts at all, so it has to hold
	// on a turn where the workflow skill was never loaded.
	it.each([
		ROUTING_END_HEADING,
		'Please run \\`<command>\\` to start this task.',
		// The pauses that need this notification mostly happen with no workflow keyword typed — an
		// upstream-Issue interrupt, a Tier C stop — so the command itself cannot live in a skill.
		'pnpm josh notify --task-type confirmation',
		'`parseArgs` rejects it',
		'**NEVER** remove or modify entries in **either** location without explicit user approval.',
		'**NEVER** modify the `devEngines` field in `package.json` without explicit user confirmation.',
	])('keeps %j resident', (marker) => {
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

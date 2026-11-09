import { readdirSync } from 'node:fs'
import { cost_tokens } from '#scripts/cost-runtime/cost-tokens'
import { AI_DOCS, read_repo_file } from '#scripts/document/ai-document-fixture'
import { resident_budget } from '#scripts/document/resident-budget'
import { init_logic } from '#scripts/init/init-logic'
import { skill_meta } from '#tools/claude/skill-meta'
import { describe, expect, it } from 'vitest'
import { package_file, read_skill_file, SKILL_ROOT } from './skill-fixture'

// joshuafolkken/kit#854: the three AI documents are read in full on every turn, and roughly half of
// each was procedure for a workflow most turns never enter. Those sections now live in skills the
// documents route to. The split only holds if three things are true together — the skills ship, the
// documents route to them, and the prohibitions that have to fire *before* a skill is loaded stay
// resident — so all three are asserted here rather than left to the section that moved.
const WORKFLOW_SKILL = '.claude/skills/workflow-commands'

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

// The headings of the sections that stayed resident. `ROUTING_END_HEADING` doubles as the marker for
// the rule that cannot move — it is the first thing after the routing table.
const ROUTING_HEADING = '### Shorthand Commands'
const ROUTING_END_HEADING = '#### Explicit invocation required (MANDATORY)'
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

	// A command that stashes the working tree and never pops it leaves the user's changes buried in
	// the stash list with the run reporting success (joshuafolkken/kit#2050). joshuafolkken/kit#5747
	// moved a `new` entry's stash, sync and pop into `run:entry <N> --adopt`, whose pop by message is
	// pinned in `run-entry-sync.test.ts`, so the step lists hand it over rather than stash by hand.
	it.each([FULLRUN_STEPS_FILE, HALFRUN_FILE])('%s hands its stash to run:entry', (filename) => {
		const content = read_skill_file(WORKFLOW_SKILL, filename)

		expect(content).toContain('--adopt`')
		expect(content).not.toContain('pnpm josh stash:')
	})
})

describe.each(AI_DOCS)('%s — stays inside the resident budget', (document_path) => {
	const content = read_repo_file(document_path)

	// The guard floor preserves enough room for the next resident rule. A ceiling-only assertion
	// cannot guarantee that reserve; asserting both would duplicate the same failure condition
	// (joshuafolkken/kit#1275).
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

// The rules that pass the residency criterion bind on a turn where no skill was loaded, so each
// document keeps its routing and the pointers to the moved bodies. One contract: a rename of any of
// these leaves the resident text routing nowhere.
describe.each(AI_DOCS)('%s — keeps the routing and pointers resident', (document_path) => {
	const content = read_repo_file(document_path)

	it.each([
		ROUTING_HEADING,
		ROUTING_END_HEADING,
		PACKAGE_FIRST_HEADING,
		// The skills ship as the `kit` plugin (joshuafolkken/kit#1879), so the document routes to them
		// by skill name rather than by a `.claude/skills/…` path that would not resolve at a consumer.
		'`workflow-commands` skill',
		'`dependency-update` skill',
		'`prompts/collaboration-workflow/operating-rules.md` → "git-rules"',
		'`prompts/collaboration-workflow/rule-delivery.md` → "stop-notify"',
		// The `overrides` protection entry of the resident-rule list in `residency-rationale.md`.
		'`devEngines` / overrides edits): explicit user instruction only',
	])('keeps %j resident', (marker) => {
		expect(content).toContain(marker)
	})
})

// joshuafolkken/kit#964: the residency criterion decides *whether* a rule stays; this is the guard
// on *how much* of it stays. A rule that cites a canonical section has its procedure there, so the
// resident text is a trigger and a pointer — and a trigger that grew past this cap has had its
// procedure pasted back beside the pointer, which is how `CLAUDE.md` ran out of headroom with the
// procedures already moved out.
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
// is the rule. Line-by-line matching also avoids materializing an iterator (joshuafolkken/kit#1783).
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

import { read_repo_file, read_unwrapped } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#904: the entry points had no way to name a target repository, so a conclusion
// reached in one repository could only be filed into that same one and a person said the
// destination out loud every time. `epicrun` already accepted `owner/repo#E`; the other four were
// left behind. The correction is the one joshuafolkken/kit#865 made for the split assessment — one
// definition, referenced by every entry point — so this suite pins the definition in both places it
// has to exist, and pins that all five entries point at it rather than restating it.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CANONICAL = 'prompts/collaboration-workflow/target-repo.md'
const BOTH: ReadonlyArray<string> = [SKILL, CANONICAL]

// Every entry point, in the notation each one takes. `kickoff` carries the two extra forms because
// `#new` occupies the slot a number occupies, and a quoted title still follows it.
const ENTRY_FORMS: ReadonlyArray<string> = [
	'kickoff joshuafolkken/kit#412',
	'kickoff kit#new',
	'kickoff kit#new "<title>"',
	'fullrun joshuafolkken/app-kit#12',
	'halfrun kit#412',
	'queue kit#1 kit#2',
	'epicrun joshuafolkken/kit#858',
]

// The five entry files. A file that does not name the definition is a file that will grow a second
// one, which is exactly the defect the acceptance criteria call out ("do not fix one entry point").
const ENTRY_FILES: ReadonlyArray<string> = [
	'.claude/skills/workflow-commands/kickoff.md',
	'.claude/skills/workflow-commands/fullrun.md',
	'.claude/skills/workflow-commands/halfrun.md',
	'.claude/skills/workflow-commands/queue.md',
	'.claude/skills/workflow-commands/epicrun.md',
]

describe.each(BOTH)('%s — the prefix is written down', (document_path) => {
	const unwrapped = read_unwrapped(document_path)

	it.each(ENTRY_FORMS)('accepts %j', (form) => {
		expect(unwrapped).toContain(form)
	})

	// Prefixing the session owner is what makes the expansion deterministic. Searching
	// joshuafolkken/kit#869's map instead would answer a different question — where a checkout is —
	// and would drop a repository that is not checked out here, which is still a valid target.
	it('expands a short name by prefixing the session owner', () => {
		expect(unwrapped).toMatch(
			/expands by prefixing the session repository's owner|owner を前置して/u,
		)
	})

	it('says the expansion does not search the discovery map', () => {
		expect(unwrapped).toMatch(/never by searching|マップは引かない/u)
	})

	// The safety argument the notation rests on: the first-party test is owner equality, and a name
	// built by prefixing the session owner satisfies it by construction.
	it('grounds the safety claim in owner equality', () => {
		expect(unwrapped).toMatch(/owner equality|owner の一致だけ/u)
	})
})

describe.each(BOTH)('%s — what each entry point does with it', (document_path) => {
	const unwrapped = read_unwrapped(document_path)

	// Without this the prefix would be a behavior change for every run that does not use it.
	it('says an omitted prefix changes nothing', () => {
		expect(unwrapped).toMatch(
			/No prefix leaves the behavior exactly as it was|既存の打鍵は 1 つも意味が変わらない/u,
		)
	})

	// The plan-only entry completes through `gh -R`, so requiring a checkout there would refuse work
	// that needs none.
	it('completes the plan-only entry without a checkout', () => {
		expect(unwrapped).toMatch(/needs no checkout|チェックアウトは要らない/u)
		expect(unwrapped).toContain('-R <owner/repo>')
	})

	// The read is where `-R` is forgotten, and forgetting it plans against this repository's issue of
	// the same number without erroring.
	it('requires the prefix on reads too', () => {
		expect(unwrapped).toContain('gh issue view')
	})

	// The short form is now the recommended notation, so it has to leave a run against this
	// repository behaving exactly as the bare `#N` form did — dirty tree included.
	it('leaves a prefix naming the session repository behaving as before', () => {
		expect(unwrapped).toMatch(
			/prefix naming the session's own repository changes nothing|セッション自身のリポジトリでない場合だけ/u,
		)
	})

	// Cloning decides the layout of someone's machine for them — joshuafolkken/kit#869 settled that
	// for the map, and an implementing entry inherits it.
	it('stops rather than cloning when the target has no checkout', () => {
		expect(unwrapped).toMatch(/never create one|勝手に clone しない/u)
		expect(unwrapped).toContain('pnpm josh doctor')
	})

	// A dirty tree in the target holds work that is not this run's to stash.
	it('stops on a target checkout that is not clean', () => {
		expect(unwrapped).toMatch(/not clean|clean でなければ/u)
	})
})

describe.each(BOTH)('%s — the writes it refuses', (document_path) => {
	const unwrapped = read_unwrapped(document_path)

	// The owner-equality argument covers short names only. An explicit `<other-owner>/repo#12` names a
	// tracker we do not own, and filing there under the user's identity is the Tier C write
	// `CLAUDE.md` forbids without an instruction typed in the same turn.
	it('stops on a target whose owner is not the session owner', () => {
		expect(unwrapped).toMatch(/third-party target|third-party の指定である/u)
		expect(unwrapped).toMatch(/Tier C/u)
	})

	// `--promote` writes only its own repository, and creating an epic instead leaves `#N` neither
	// promoted nor tracked — the discussion that produced the split is what goes missing.
	it('refuses to substitute creation for the promote arm', () => {
		expect(unwrapped).toMatch(
			/promote arm has no such fallback|昇格（`pnpm josh epic --promote`）を選ぶ分岐/u,
		)
	})

	// `epic --add` reads and writes only the repository it runs in, so a cross-repository `into`
	// target is inserted from that epic's checkout rather than from the run's.
	it('keeps a command naming another repository in that repository', () => {
		expect(unwrapped).toMatch(/naming a different repository|別のリポジトリを名指しするコマンド/u)
	})

	// The prefix says where the epic lives; which session implements which child is a different
	// question, already answered by the per-repository concurrency model.
	it('exempts `epicrun` from the checkout rules its epic reference would imply', () => {
		expect(unwrapped).toMatch(/exempt from the whole bullet|`epicrun` の起動には掛からない/u)
	})

	// Two qualifications on one line mean two different questions; collapsing them would make
	// `kickoff kit#new into joshuafolkken/kit#909` unreadable.
	it('separates the prefix from the `into` suffix', () => {
		expect(unwrapped).toMatch(/Independent of `into <target>`|`into <target>` とは独立した/u)
	})
})

// The skill is what a run reads; the canonical is where a disagreement is settled. A skill that does
// not name the canonical leaves the second unreachable.
describe(`${SKILL} — points at the canonical`, () => {
	it('names the topic file', () => {
		expect(read_repo_file(SKILL)).toContain(CANONICAL)
	})
})

// One definition, every entry point. Each entry file references it; none of them restates it.
describe.each(ENTRY_FILES)('%s — references the one definition', (document_path) => {
	const unwrapped = read_unwrapped(document_path)

	it('names the section in the skill', () => {
		expect(unwrapped).toContain('2c. The `owner/repo#` prefix')
	})

	it('names the canonical topic file', () => {
		expect(unwrapped).toContain(CANONICAL)
	})

	// Referencing and restating are different things: a second copy of the expansion rule is what
	// lets two entry points drift apart, which is the defect this issue was filed about.
	it('does not restate the expansion rule', () => {
		expect(unwrapped).not.toMatch(/prefixing the session repository's owner|owner を前置して/u)
	})
})

import { read_unwrapped } from '#scripts/ai-document-fixture'
import { describe, expect, it } from 'vitest'

// joshuafolkken/kit#904: the entry points had no way to name a target repository, so a conclusion
// reached in one repository could only be filed into that same one and a person said the
// destination out loud every time. `epicrun` already accepted `owner/repo#E`; the other four were
// left behind. The correction is the one joshuafolkken/kit#865 made for the split assessment — one
// definition, referenced by every entry point.
//
// joshuafolkken/kit#1182: that definition is single-sourced into the skill and the canonical topic
// file is now a pointer to it (the joshuafolkken/kit#1174 pattern, rolled out under
// joshuafolkken/kit#1176). The canonical was formerly a Japanese full copy asserted here beside the
// skill, marker for marker; those paired assertions become skill-only ones, plus the folded-in
// suites that pin what the canonical alone used to carry and the pointer suite at the bottom.

const SKILL = '.claude/skills/workflow-commands/SKILL.md'
const CANONICAL = 'prompts/collaboration-workflow/target-repo.md'

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

describe(`${SKILL} — the prefix is written down`, () => {
	const unwrapped = read_unwrapped(SKILL)

	it.each(ENTRY_FORMS)('accepts %j', (form) => {
		expect(unwrapped).toContain(form)
	})

	// Prefixing the session owner is what makes the expansion deterministic. Searching
	// joshuafolkken/kit#869's map instead would answer a different question — where a checkout is —
	// and would drop a repository that is not checked out here, which is still a valid target.
	it('expands a short name by prefixing the session owner', () => {
		expect(unwrapped).toContain("expands by prefixing the session repository's owner")
	})

	it('says the expansion does not search the discovery map', () => {
		expect(unwrapped).toContain('never by searching')
	})

	// The safety argument the notation rests on: the first-party test is owner equality, and a name
	// built by prefixing the session owner satisfies it by construction.
	it('grounds the safety claim in owner equality', () => {
		expect(unwrapped).toContain('owner equality')
	})
})

describe(`${SKILL} — what each entry point does with it`, () => {
	const unwrapped = read_unwrapped(SKILL)

	// Without this the prefix would be a behavior change for every run that does not use it.
	it('says an omitted prefix changes nothing', () => {
		expect(unwrapped).toContain('No prefix leaves the behavior exactly as it was')
	})

	// The plan-only entry completes by naming the target repository in each REST path, so requiring a
	// checkout there would refuse work that needs none. It used to be `gh -R`; the calls moved to
	// `gh api` because `gh issue view` / `create` / `edit` go through GraphQL, which a cloud session
	// is refused (joshuafolkken/kit#1054).
	it('completes the plan-only entry without a checkout', () => {
		expect(unwrapped).toContain('needs no checkout')
		expect(unwrapped).toContain('repos/<owner/repo>')
	})

	// The short form is now the recommended notation, so it has to leave a run against this
	// repository behaving exactly as the bare `#N` form did — dirty tree included.
	it('leaves a prefix naming the session repository behaving as before', () => {
		expect(unwrapped).toContain("prefix naming the session's own repository changes nothing")
	})

	// Cloning decides the layout of someone's machine for them — joshuafolkken/kit#869 settled that
	// for the map, and an implementing entry inherits it.
	it('stops rather than cloning when the target has no checkout', () => {
		expect(unwrapped).toContain('never create one')
		expect(unwrapped).toContain('pnpm josh doctor')
	})

	// A dirty tree in the target holds work that is not this run's to stash.
	it('stops on a target checkout that is not clean', () => {
		expect(unwrapped).toContain('not clean')
	})
})

describe(`${SKILL} — the writes it refuses`, () => {
	const unwrapped = read_unwrapped(SKILL)

	// The owner-equality argument covers short names only. An explicit `<other-owner>/repo#12` names a
	// tracker we do not own, and filing there under the user's identity is the Tier C write
	// `CLAUDE.md` forbids without an instruction typed in the same turn. This is the acceptance
	// criterion that says the third-party stop survives the move into the skill.
	it('stops on a target whose owner is not the session owner', () => {
		expect(unwrapped).toContain('third-party target, and it stops the run')
		expect(unwrapped).toContain('Tier C')
		expect(unwrapped).toContain('`confirmation` Telegram and stop')
	})

	// `--promote` writes only its own repository, and creating an epic instead leaves `#N` neither
	// promoted nor tracked — the discussion that produced the split is what goes missing.
	it('refuses to substitute creation for the promote arm', () => {
		expect(unwrapped).toContain('promote arm has no such fallback')
	})

	// `epic --add` reads and writes only the repository it runs in, so a cross-repository `into`
	// target is inserted from that epic's checkout rather than from the run's.
	it('keeps a command naming another repository in that repository', () => {
		expect(unwrapped).toContain('naming a different repository')
	})

	// The prefix says where the epic lives; which session implements which child is a different
	// question, already answered by the per-repository concurrency model.
	it('exempts `epicrun` from the checkout rules its epic reference would imply', () => {
		expect(unwrapped).toContain('exempt from the whole bullet')
	})

	// Two qualifications on one line mean two different questions; collapsing them would make
	// `kickoff kit#new into joshuafolkken/kit#909` unreadable.
	it('separates the prefix from the `into` suffix', () => {
		expect(unwrapped).toContain('Independent of `into <target>`')
		expect(unwrapped).toContain('kickoff kit#new into joshuafolkken/kit#909')
	})
})

// The first half of what the canonical alone used to carry. `SKILL.md` → "Trimming is moving, never
// deleting.": each of these had to exist in the single source before the Japanese full copy was cut,
// so they are pinned by name rather than left to be noticed missing later.
describe(`${SKILL} — carries the origin only the canonical used to give`, () => {
	const unwrapped = read_unwrapped(SKILL)

	// The filing this prefix came from, and what a person did instead before it existed.
	it('names the origin and what it replaced', () => {
		expect(unwrapped).toContain('joshuafolkken/kit#904')
		expect(unwrapped).toContain('daily rather than exceptional')
	})

	// `epicrun owner/repo#E` was already the right spelling, so this was never a new notation — only
	// the entries were missing from one that existed. Dropped, the next editor invents a second one.
	it('names the precedent the entry points were left out of', () => {
		expect(unwrapped).toContain('only the entry points had been left out of it')
	})

	// The shape of the correction, which is why the definition sits in one section rather than five.
	it('names the correction it repeats', () => {
		expect(unwrapped).toContain('joshuafolkken/kit#865')
	})

	// Residency is decided by one question, and the answer for this rule is the reason it lives in a
	// skill at all. Without it the next editor re-opens a decision already made.
	it('says why the notation is not resident', () => {
		expect(unwrapped).toContain('It is not resident')
		expect(unwrapped).toContain('joshuafolkken/kit#985')
	})
})

describe(`${SKILL} — carries the failure modes only the canonical named`, () => {
	const unwrapped = read_unwrapped(SKILL)

	// A bare repository name and a bare issue number fail differently, and reading the standing
	// prohibition as covering both would forbid the short form this section recommends.
	it('separates a bare repository name from a bare `#N`', () => {
		expect(unwrapped).toContain('It is not the standing prohibition on a bare `#N`')
	})

	// The gate the map already applies to every discovered entry is the same one owner equality is,
	// which is what makes the short form safe by construction rather than by convention.
	it('names the gate the short-name claim reuses', () => {
		expect(unwrapped).toContain('repo_map_logic.is_same_owner')
		expect(unwrapped).toContain('structurally no path')
	})

	// The read is where the target repository is forgotten, and forgetting it plans against this
	// repository's issue of the same number without erroring.
	it('requires the target repository on reads too', () => {
		expect(unwrapped).toContain('The read is where it is forgotten')
		expect(unwrapped).toContain('repos/{owner}/{repo}/issues/412')
	})

	// The manual epic fallback cannot run `epic:check`, and reporting the run as checked anyway is
	// the failure the canonical spelled out.
	it('forbids reporting a check that never ran as run', () => {
		expect(unwrapped).toContain('never report as checked something that was not checked')
	})

	// Not cloning is the same judgement the discovery map already made, and a third-party filing is
	// irreversible in ways closing the Issue does not undo.
	it('grounds the two stops in what cannot be taken back', () => {
		expect(unwrapped).toContain('the same judgement kit#869 made')
		expect(unwrapped).toContain('taken back afterwards')
	})
})

// One definition, every entry point. Each entry file references it; none of them restates it, and
// since joshuafolkken/kit#1178 none of them cites the topic file that has become a pointer either.
describe.each(ENTRY_FILES)('%s — references the one definition', (document_path) => {
	const unwrapped = read_unwrapped(document_path)

	it('names the section in the skill', () => {
		expect(unwrapped).toContain('2c. The `owner/repo#` prefix')
	})

	// Referencing and restating are different things: a second copy of the expansion rule is what
	// lets two entry points drift apart, which is the defect this issue was filed about. Both
	// spellings stay matched: the entry files are English today, and a restatement arriving in the
	// canonical's Japanese wording is the one this alternation was already catching.
	it('does not restate the expansion rule', () => {
		expect(unwrapped).not.toMatch(/prefixing the session repository's owner|owner を前置して/u)
	})
})

// joshuafolkken/kit#1182: the canonical topic file is a pointer to the skill single source, not a
// second copy. The pointer test names the source; the body test proves the Japanese full copy that
// used to live here — asserted marker for marker above until this rollout — has not crept back.
describe('the canonical topic file is a pointer to the skill single source', () => {
	const POINTER_MARKERS: ReadonlyArray<string> = [SKILL, 'クローン禁止・単一ソース化']
	// One marker per section the Japanese body used to carry, not merely a couple. The generic size
	// check in `pointer-citation-document-rule.test.ts` compares this pointer against the whole of
	// `SKILL.md`, so a single paragraph creeping back would stay far under it and pass — the
	// paragraph-level guard has to live here.
	const REMOVED_BODY_MARKERS: ReadonlyArray<string> = [
		'そのたびに人が口頭で起票先を指示していた',
		'入口だけがこの記法から取り残されていた',
		'マップが答えるのは「チェックアウトがどこにあるか」であって',
		'禁じられているのは裸の',
		'読み取りにこそ付け忘れやすく、付け忘れは黙って通る',
		'勝手に clone することは人の作業機の配置を勝手に決めることである',
		'子を実装するリポジトリではない',
		'常駐判定の問いは',
	]

	it('names the skill as the single source', () => {
		const content = read_unwrapped(CANONICAL)

		for (const marker of POINTER_MARKERS) expect(content).toContain(marker)
	})

	it('does not duplicate the rule body', () => {
		const content = read_unwrapped(CANONICAL)

		for (const marker of REMOVED_BODY_MARKERS) expect(content).not.toContain(marker)
	})

	// A back-reference from the single source itself costs no second hop, and it is what tells a
	// reader who landed on the skill that the topic file holds no body.
	it('is named as a pointer by the skill that now holds the body', () => {
		expect(read_unwrapped(SKILL)).toContain(`\`${CANONICAL}\` is a pointer to it`)
	})
})

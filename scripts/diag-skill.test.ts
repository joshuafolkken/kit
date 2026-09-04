import { describe, expect, it } from 'vitest'
import { AI_DOCS, read_repo_file } from './ai-document-fixture'
import { read_skill_file, SKILL_ENTRY_FILE } from './skill-fixture'

// joshuafolkken/kit#1270: `josh time` made the measurement a command, but reading its numbers and
// deciding what to cut was still pasted in as a prompt each time — so the wording drifted, and with
// it the analysis. The procedure is a skill the shorthand table routes to, and this suite asserts
// the two halves that make it reachable: the skill ships, and `CLAUDE.md` names it.
const SKILL_DIRECTORY = '.claude/skills/diag'
// Derived rather than spelled out, so the path these describes name stays the file `read_skill`
// actually opens.
const SKILL_PATH = `${SKILL_DIRECTORY}/${SKILL_ENTRY_FILE}`
// The exact cell the shorthand table gained. Asserted as the keyword and the pointer separately: a
// row whose keyword survives a reformat but whose pointer does not is a row that routes nowhere.
const TABLE_KEYWORD = '`diag [fullrun \\| epicrun \\| #N]`'

function read_skill(): string {
	return read_skill_file(SKILL_DIRECTORY)
}

// `workflow-skills.test.ts` enumerates the skill directories from disk and already asserts the
// frontmatter, the declared name and the distribution membership for every one it finds, so none of
// that is repeated here. What that suite cannot assert is the pair: the row in `CLAUDE.md` and the
// skill it points at are only useful together — a row aimed at a path that ships nothing routes an
// agent nowhere, and a skill no document names is one nothing opens. That link is this suite's.
describe(`${SKILL_PATH} — the row and the skill it points at ship together`, () => {
	it('ships the skill file the shorthand row names', () => {
		expect(read_skill().length).toBeGreaterThan(0)
	})
})

// The four steps the issue specified. Each one is a thing the pasted-in prompt did inconsistently,
// so a skill missing any of them ships the same drift under a keyword.
describe(`${SKILL_PATH} — carries the four steps`, () => {
	it.each([
		'## 1. Measure with `pnpm josh time`, never by hand',
		'## 2. Say whether the last speedup actually worked',
		'## 3. One ranked list — already-filed issues stay in it',
		'## 4. File only through `pnpm josh issue:scout`',
	])('states %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// The measurement is the one thing the skill must not reimplement: a second reader of the
	// transcripts is a second classification, which is exactly what makes two runs incomparable.
	it.each([
		'pnpm josh time --json',
		'pnpm josh time --issue <N> --json',
		'**Never write a script to read the transcripts, and never restore the timings by eye.**',
		'It does not measure anything itself.',
	])('defers the measurement to josh time: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})
})

// joshuafolkken/kit#1307. The round-trip *count* reached the report first, and a count cannot be
// ranked in a table ordered by minutes saved — which is how the 2026-09-04 run left round-trip
// reduction off its candidate table entirely. So the step that reads the JSON has to name the unit
// price, not only the two counts it is divided from.
describe(`${SKILL_PATH} — reads the price of a round trip, not only the count`, () => {
	it.each([
		'**the price of one round trip**',
		'`ms_per_round_trip`',
		'`model_ms_per_round_trip`',
		"without it the round trips cannot enter step 3's table at all",
	])('states %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})
})

// The correction the issue was edited to make. A ranked list that drops what is already filed
// reports the backlog as emptier than it is, and an un-started issue that ranks high is usually the
// cheapest action there is — it needs a run, not a filing.
describe(`${SKILL_PATH} — keeps already-filed issues in the ranking`, () => {
	it.each([
		'**Do not drop an item because it is already filed.**',
		'un-started issue is usually the highest-priority action in the table**',
		'| Un-filed |',
		'| Filed, not started |',
		'| In progress |',
		'| Done |',
		'`fullrun #N`, or `epicrun #E`',
		'Never a second filing',
	])('states %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// GitHub treats `In-Progress` as the same label as `in-progress`, so an eye comparing against the
	// lowercase string reports an in-progress issue as un-started — and the table then tells someone
	// to start a run that is already going.
	it.each([
		'**Read the state from `pnpm josh issue:state <N> [<N> ...]`, never by parsing `gh` output yourself —',
		'the `labels:` line is compared case-insensitively',
	])('reads issue state through the command: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// joshuafolkken/kit#1302: the table reads a state per row, and one call per row paid a process
	// start and a round trip each. Reading them in one call is only safe while each block names its
	// own number — a number that produced no state prints none, so position cannot be trusted.
	it.each([
		"pass the whole table's numbers in one call",
		'**Attribute each block by its `issue:` line, never by position.**',
		'pnpm josh issue:state 1262 1222 1176',
	])('reads the whole table in one call: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	it('routes a filing through the scout before it files', () => {
		expect(read_skill()).toContain('pnpm josh issue:scout "<title>"')
		expect(read_skill()).toContain('pnpm josh epic:bundle <new>')
	})
})

// joshuafolkken/kit#1308. The rule above says an un-started issue usually ranks highest and said
// nothing about how to find one, so the candidate set came from whatever the session remembered —
// the 2026-09-04 run left #1226, #1170, #1095 and #1102 out of its table while a report written by
// hand from the same run carried all four. The enumeration is one command now, and this suite pins
// it plus the two readings a listing of every open issue depends on.
describe(`${SKILL_PATH} — enumerates the backlog rather than recalling it`, () => {
	it.each([
		'**Enumerate the backlog before ranking it — never from memory.**',
		'gh api --paginate "repos/{owner}/{repo}/issues?state=open&per_page=100"',
		'select(.pull_request | not)',
		'**It is the one GitHub call this skill makes by hand, and that is deliberate.**',
		'scripts/git/git-gh-issue-list.ts',
	])('names the one listing every report runs: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// An epic and its children are ordinary issues, so one flat listing reaches both. Saying so is
	// what stops a reader concluding that a child inside an epic body needs its own enumeration, or
	// that an epic is a container rather than a row.
	it.each([
		"**An epic's child is an ordinary issue and appears on its own row.**",
		'**An epic is an issue too**',
		'**A foreign repository is named in the path, never by a flag.**',
		'`repos/<owner>/<name>/issues?state=open&per_page=100`',
	])('places an epic and its children in the same listing: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// The listing prints a number and a title; the state comes from the command. Reporting what the
	// listing returned and what survived the narrowing is what makes a later miss detectable at all.
	it.each([
		'**It enumerates; it does not read state.**',
		'**Narrow by reading the titles, then say what you narrowed to.**',
		'**Pass the numbers the enumeration above kept**',
	])('checks the enumerated numbers through issue:state: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})
})

// `diag` is analysis. It sits in the shorthand table because that is where an agent looks up a typed
// keyword, not because it starts anything — and a reader who concludes otherwise gets a run nobody
// invoked, which is the one thing the explicit-invocation rule exists to prevent.
describe(`${SKILL_PATH} — starts no workflow`, () => {
	it.each([
		'**`diag` is analysis, not a workflow.**',
		'It does not run `fullrun` / `epicrun` on what it ranks. It prints the command; the person types it.',
	])('states %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})
})

describe.each(AI_DOCS)('%s — routes the diag keyword to the shipped skill', (document_path) => {
	const content = read_repo_file(document_path)

	it('carries the shorthand table row', () => {
		expect(content).toContain(TABLE_KEYWORD)
	})

	it('points the row at the skill this package distributes', () => {
		expect(content).toContain(SKILL_PATH)
	})

	// The row is a pointer, not a second copy of the procedure. The steps live in the skill, and a
	// document that restates them is spending resident budget on a rule that only binds after the
	// keyword has been typed.
	it.each(['pnpm josh issue:scout', '## 3. One ranked list'])(
		'does not inline the procedure: %j',
		(marker) => {
			expect(content).not.toContain(marker)
		},
	)
})

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
		'## 1. Measure with `pnpm josh time` and `pnpm josh cost`, never by hand',
		'## 2. Say whether the last speedup actually worked',
		'## 3. One ranked list — already-filed issues stay in it',
		'## 4. File only through `pnpm josh issue:scout`',
	])('states %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// The measurement is the one thing the skill must not reimplement: a second reader of the
	// transcripts is a second classification, which is exactly what makes two runs incomparable.
	it.each([
		'pnpm josh time --top 5 --json',
		'pnpm josh time --issue <N> --top 5 --json',
		'**Never write a script to read the transcripts, and never restore the timings by eye.**',
		'It does not measure anything itself.',
	])('defers the measurement to josh time: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})
})

// joshuafolkken/kit#1301. `--json` carried every row of the per-tool and per-`josh <cmd>` tables, and
// an epic pays for both once per child — 47.7 KB at nine children, and more than double that by
// eighteen — all of it read into the context for the handful of rows this skill actually ranks. The
// cap is part of the call, so the markers pin the flag *and* the two readings that keep a capped
// table from being mistaken for a complete one.
describe(`${SKILL_PATH} — caps the two tables it ranks off`, () => {
	it.each([
		'**`--top 5` is part of the call, not a nicety**',
		'**A cut table says so, and that note is not a zero.**',
		'**Never read a capped table as the whole of what ran.**',
		'**Drop the flag when the tail is the question.**',
	])('states %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})
})

// joshuafolkken/kit#1607. `recoverable_round_trips` counted the avoidable turns and attributed none
// of them, so the skill's own "name the tool to batch" had no measured field behind it and the tool
// was found by reading the transcript by hand, once per run. The markers pin both ends: step 1 reads
// the breakdown and its reconciliation, and step 3's ranked row is written from a tool name.
describe(`${SKILL_PATH} — names the tool a recoverable trip belongs to`, () => {
	it.each([
		'**`by_tool` inside it names whose turns those trips were**',
		'defect in the report, not a bucket of unlabelled calls**',
		'`13 of 13 attributed`',
		'row that does not balance is a defect',
		'**Name the tool from `bundles.by_tool`, and use this table as the check on it**',
		'**A batching row names the tool, never the density**',
	])('states %j', (marker) => {
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

// joshuafolkken/kit#1609. `josh cost` shipped and `grep -c 'josh cost'` over this skill returned 0,
// so every table it emitted was ordered by minutes alone — on a backlog whose own epic records credit
// as the larger of the two costs. The markers pin the call, the scope flag it is *not* passed with,
// and the derived readings, because a figure re-derived by hand each time is the repetition #1609 was
// filed to end.
describe(`${SKILL_PATH} — reads what the run cost, not only how long it took`, () => {
	it.each([
		'**A third reading is not `josh time`',
		'pnpm josh cost --issue <N> --json',
		'**`--over` is not the flag this step wants, and the command refuses it beside `--issue`, `--all` and `--json` alike**',
		'**The output is an array of reports even where the scope is one issue**',
		'**Four derived readings come out of them, and the JSON prints none of them**',
	])('states %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// The `missing` counters are the cost side of the distinction the rest of this skill already makes
	// for `span_count: 0` and `not detected`: a corpus that could not be priced is unmeasured, and a
	// `cost_usd` quoted beside one is a floor rather than the run's cost.
	it.each([
		'**Read `missing` before quoting any of them, and a non-zero count is unmeasured rather than zero.**',
		'`no_usage_lines`, `malformed_lines`, `unreadable_sessions`',
		'**withheld is not measured as zero**',
		'`unattributed_sessions` is the fourth',
		'a `missing` of three zeros is not proof of a complete read',
	])('does not read an unpriced corpus as zero dollars: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// joshuafolkken/kit#1812: the gate is launched into the background, so its phase and its
	// per-invocation rows are the dispatch and not the runtime — read like `ci`, whose `ci: 0` never
	// meant nobody waited. The runtime is the `Gate runtime (backgrounded)` block.
	it.each([
		'**`gate` is read like `ci`, and for the same reason**',
		'`Gate runtime (backgrounded)`',
		'A small `gate` figure no more means the gate was fast than',
	])('reads the backgrounded gate runtime like ci: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// joshuafolkken/kit#1606 built the axis this reading used to defer: `josh cost` still attributes a
	// request to an issue and to nothing finer, and the per-phase figure is `josh time`'s `phase_costs`.
	// The markers pin where each half is read from, so neither is re-derived as a share of the total.
	it.each([
		"**The phase axis is `josh time`'s, not this command's, and it is read from there**",
		'https://github.com/joshuafolkken/kit/issues/1606',
	])('reads the phase axis from the command that owns it: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})
})

// joshuafolkken/kit#1606. `josh time` knew the phases and `josh cost` knew the money, and the two met
// nowhere — so step 3 could rank a proposal in minutes and never in dollars. The markers pin the two
// new readings and, more importantly, the three ways of misreading them: an unattributed request is
// never prorated, an unread corpus is not a run that spent nothing, and a per-phase saving comes from
// that phase's own row rather than from a share of the run total.
describe(`${SKILL_PATH} — attributes the money to the phases it was spent in`, () => {
	it.each([
		'**`phase_costs` — what each stage cost in dollars**',
		'**`unattributed` is a bucket, not a rounding error**',
		'**`is_measured: false` means the cost corpus was not read for this scope',
		'**`usd_per_round_trip` is the same reading in money**',
		'**the same denominator**',
		"**A row against one stage takes its dollars from that stage's own `phase_costs` row, not from the run total**",
		'**The unattributed bucket is never spread across the rows to make them add up**',
	])('states %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})
})

// The other half of joshuafolkken/kit#1609: a reading nothing ranks off is one nobody takes. Kept as
// its own suite because the two halves fail for different reasons — the one above loses the figures,
// this one loses the column they would go in.
describe(`${SKILL_PATH} — ranks in minutes and dollars, not minutes alone`, () => {
	// The two units are not interchangeable: a CI wait is minutes at no cost, and a carried prompt is
	// cost at no measurable wall clock. A table that converted between them would rank one as the other.
	it.each([
		'**Every row carries both units — minutes per run and dollars per run — and names which one it acts on**',
		'**The two do not follow from one another and are never converted between**',
		'**Order by whichever unit the report was asked for, and say which at the head of the table.**',
		"**Estimate the dollar saving from step 1's per-request figures, never as a share of `cost_usd`.**",
		'**Where `missing` was non-zero, a row that has a dollar saving still prints one and is never blanked.**',
		'**Label such a figure approximate rather than as a bound.**',
		'**a row that saves no money keeps the `—` the rule above gives it**',
	])('ranks in both units: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// The closing enumeration is what a reader checks the report's provenance against, so it has to
	// name every source the steps above actually read — it named three while step 1 read four.
	it.each([
		'**Every figure in its report came out of one of four',
		"`pnpm josh cost`'s — two readings of the same recorded sessions",
	])('counts its own sources correctly: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})
})

// joshuafolkken/kit#1412. `segments` already carried both review rounds of run #1399 — 260.1 s and
// 259.9 s — and step 1 had no rule for comparing two rows of the same phase, so the report printed
// the pair as two bare numbers and converted nothing. The markers pin the comparison, the threshold
// and its evidence, because a threshold with no distribution under it is one the next reader lowers.
describe(`${SKILL_PATH} — compares the two review rounds rather than printing them`, () => {
	it.each([
		'**the two review rounds against each other**',
		'**Take the ratio round 2 ÷ round 1, and report it at 0.95 or above.**',
		'**The threshold rests on a distribution, and that distribution is not quoted here.**',
		'**Read those figures there rather than from a copy here**',
	])('states %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// The two rounds are separated by the commit (joshuafolkken/kit#1261), and the flicker rule can cut
	// one round into two segments — so a pair identified by the phase name alone compares a round
	// against half of itself. The `pr` row is the evidence, and it is also the row `--top 5` drops:
	// it kept both 260 s review rows of run #1399 and cut the 43.2 s commit between them, which is the
	// listing this rule is read against by default.
	it.each([
		'**A pair is identified by a `pr` segment between the two `review` rows, and by nothing else.**',
		'**Its absence proves nothing, and there are two\n  ways to lose it.**',
		'**re-read\n  `segments` without `--top` before deciding a `pr` row is missing**',
		'**Two `review` rows with no `pr` between them in an uncapped listing are ambiguous, and ambiguous is',
	])('identifies the pair by the `pr` segment between them: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})
})

// The other half of the same rule: what the ratio is allowed to claim once a pair was identified. Kept
// as its own suite because the two halves fail for different reasons — the one above loses the pair,
// this one over-reads it.
describe(`${SKILL_PATH} — reports the review ratio as a signal, never as a cause`, () => {
	// The threshold is calibrated on span-level ratios and applied to segment durations, which carry
	// whatever the flicker rule absorbed — 520.0 s of segments against a 496.1 s phase on run #1399. A
	// rule that did not say so would read as though the two grains were interchangeable.
	it.each([
		'**The ratio is read on this grain and on no other.**',
		'the two rows total 520.0 s against a `review` phase of 496.1 s',
	])('says which grain the ratio is read on: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// The issue this rule came from was itself filed on a cause that turned out to be false: run #1399's
	// round 2 diffed only the fix delta. Durations say a run is in the tail; they say nothing about why.
	it.each([
		'**Name no cause, and never read one run as the mechanism.**',
		'A single ratio near 1.00 is the tail of the distribution above',
		'`pnpm josh time --session <session-id>/agent-<agent-id>`',
		'**It is a reading, not a filing**',
	])('reports the ratio without diagnosing it: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// A detector with no negative cases fires on every run that cannot answer it. Two of the five come
	// from the segment builder rather than from a withheld reading: an absorbed `pr` group emits two
	// rounds as one row, and a stretch over `MIN_SEGMENT_MS` inside a round emits one round as several
	// — so a row count is never on its own the run's round count.
	it.each([
		'**A pair is exactly two `review` rows with a `pr` row between them, and five states are not one.**',
		'**One `review` row is not a one-round run.**',
		'**More than two\n  `review` rows** is that same answer from the other side',
		'`span_count: 0` — no transcript was read, so',
		"**re-read without the flag before calling any of these states the run's shape**",
	])('does not fire where there is nothing to compare: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})
})

// joshuafolkken/kit#1403. The round cap's three-way disposition is chosen on every two-round run, and
// picking "fix it in place" buys a second commit and a second CI cycle in front of the merge — on run
// #1399, 132.8 s of a 1,198.1 s run. `josh time` already carried every one of those figures as separate
// rows, so a report printed them and connected nothing; joshuafolkken/kit#1382 asked whether to cut
// that cost, and this row is what decided it — the reading and the answer are `prompts/review.md` →
// "What a round-2 fix-in-place costs, and how often it is paid", pinned by
// `round-two-fix-cycle-cost.test.ts`. The markers pin the detector and the four sources, because a
// price line whose components are re-derived each time is one that stops comparing two runs.
describe(`${SKILL_PATH} — prices the round-2 disposition rather than listing its pieces`, () => {
	it.each([
		'- **what the round-2 disposition cost — the extra commit and the CI cycle behind it**',
		'**The detector is a `pr` segment *after* the round-2 `review` row.**',
		'**Sum exactly four stretches, and print each one beside the total**',
		'132.8 s, 11.1% of a 1,198.1 s run**',
	])('states %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// Both `pr` rows of run #1399 were 43.2 s and 34.5 s against a 177.1 s `merge` and two 260 s
	// `review` rows, so the default `--top 5` call drops the very evidence this reading is built on —
	// the detector and the second commit's own duration alike. The 30 s flicker rule takes the same row
	// away for a different reason, which is why `by_invocation` is read beside the segment listing
	// rather than after it.
	it.each([
		'**Read both from uncapped output, always.**',
		'under `MIN_SEGMENT_MS` (30 s) is absorbed rather than printed',
		'**`by_invocation` corroborates it in both directions, and neither answer is read',
	])('reads the evidence the cap and the flicker rule would cut: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	// Every way the sum could claim more than it measured. The `ci` phase is `ci_ms + serial_ci_ms`, so
	// quoting it whole bills unattended waiting as a CI cycle; a check called once has no
	// `by_invocation` row at all; a commit repairing a red gate lands where a round-2 fix would; and
	// the editing itself is a cost every exit but "drop it" would have paid.
	it.each([
		'**The sum is a re-reading of rows already in the tables, never minutes to add to the run.**',
		'**The second CI cycle is the last row of the `CI cycles` block, read as its `naked` figure**',
		'**a check called once has no `by_invocation` row**',
		'report the check as unattributed and the total as a lower',
		'**That last row is an *extra* cycle only where the detector fired.**',
		"**A second `pr` row is not proof the commit was round 2's.**",
		"**The fix's own editing time stays out of the sum.**",
	])('does not over-read the price: %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})
})

// The other half of joshuafolkken/kit#1403, and the one its acceptance conditions name explicitly: a
// run whose round 2 fixed nothing has to read as *did not occur*, never as zero minutes — a detector
// that reports 0 for both cannot produce the frequency #1382 asks for, since every unreadable run
// would count as one that did not happen.
describe(`${SKILL_PATH} — separates "did not occur" from zero and from unreadable`, () => {
	it.each([
		'**Three answers, and only one of them is a number.**',
		'no `josh git` row at all is **did not occur**',
		'never reported as 0',
		'**could not tell**',
		'answer is `could not tell`, never the negative.**',
	])('states %j', (marker) => {
		expect(read_skill()).toContain(marker)
	})

	it.each([
		'**Frequency comes from `--last <N>`, by applying this detector per run.**',
		"carries every run's whole report under `runs[]`",
		'**report the three counts rather than a rate**',
	])('counts the occurrences across runs: %j', (marker) => {
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

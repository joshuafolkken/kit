import { cost_attribute } from './cost-attribute'
import type { MissingData } from './cost-report'
import { cost_transcript, type SessionFile, type SessionUsage } from './cost-transcript'
import type { UsageRecord } from './cost-usage'

// The corpus of a project's session transcripts, and how each request in it attributes to an issue
// (joshuafolkken/kit#962, joshuafolkken/kit#1812). Split out of `cost-cli.ts` when that file passed
// its length limit: the CLI parses flags and prints reports, and this is the reading underneath every
// scope it prints — the same walk `josh time`'s phase costs read through `cost_cli.attributed`.

interface Corpus {
	sessions: Array<SessionUsage>
	// Kept beside the sessions so the whole-session scope can re-read its transcript for the two
	// decompositions (joshuafolkken/kit#1151). Parsed lazily and only for that one file: classifying
	// the content blocks of all 158 transcripts to print one issue's cost would be work nothing reads.
	files: Array<SessionFile>
	missing: MissingData
}

function accumulate_missing(sessions: ReadonlyArray<SessionUsage>): MissingData {
	return {
		no_usage_lines: sessions.reduce((sum, session) => sum + session.no_usage_lines, 0),
		malformed_lines: sessions.reduce((sum, session) => sum + session.malformed_lines, 0),
		unreadable_sessions: sessions.filter((session) => !session.is_readable).length,
		// Filled by the attribution, which is the only step that knows a unit could not follow its
		// parent; a per-session tally cannot see it, so it is zero here and set for an issue scope below.
		unattributed_sessions: 0,
	}
}

// Every session for this project, newest first. A `--session` narrows it here rather than in each
// caller, so "that session does not exist" is one answer instead of three.
function load_corpus(cwd: string, session_id?: string): Corpus {
	const files = cost_transcript.list_sessions_across(cost_transcript.transcript_directories(cwd))
	const wanted =
		session_id === undefined ? files : files.filter((file) => file.session_id === session_id)
	const sessions = wanted.map((file) => cost_transcript.read_session(file))

	return { sessions, files: wanted, missing: accumulate_missing(sessions) }
}

interface AttributedRecord {
	record: UsageRecord
	issue: number
	// The resident baseline of the session this record was read from. Carried per record because a
	// scope that spans sessions has no single baseline, and the first record of a *filtered* set is
	// a warm mid-session request rather than a preamble — reading it as one reported an issue as
	// 86.5% resident against a real session's 27.7%.
	baseline_tokens: number
	// The session this record was read from, and whether that session is a delegated unit. The cost
	// curve is built from the non-delegated (main-line) sessions' records alone, so it needs both to
	// group an issue's records back by session and drop the units (joshuafolkken/kit#1853).
	session_id: string
	is_delegated: boolean
}

interface SessionMeta {
	is_delegated: boolean
	owner: string
}

// Whether each session is a delegated unit, and which session delegated it. Read from the files
// rather than the usages because only the discovery knows where a transcript was found — a unit lives
// at `<parent>/subagents/agent-<id>.jsonl`, and its owner is the half in front of the separator.
function session_meta(corpus: Corpus): Map<string, SessionMeta> {
	return new Map(
		corpus.files.map((file) => [
			file.session_id,
			{ is_delegated: file.is_delegated, owner: cost_transcript.owning_session_id(file) },
		]),
	)
}

// Every distinct issue a session's own records attribute to. A delegated unit reads this from the
// session that delegated it (joshuafolkken/kit#1812): a `fullrun`'s parent names exactly one, so its
// units follow it; a parent that ran several names them all, and its unattributed unit could belong to
// any of them.
function issue_set(records: ReadonlyArray<UsageRecord>): Set<number> {
	const issues = cost_attribute
		.group_by_issue(records)
		.map((group) => group.issue)
		.filter((issue) => issue !== cost_attribute.UNATTRIBUTED_KEY)

	return new Set(issues)
}

// The one issue to inherit, or `UNATTRIBUTED_KEY` where the parent named none or more than one — in
// which case a unit's own-branchless records stay unattributed and the set above says which issues
// they might have belonged to.
function sole_of(issues: ReadonlySet<number>): number {
	if (issues.size !== 1) return cost_attribute.UNATTRIBUTED_KEY

	return [...issues][0] ?? cost_attribute.UNATTRIBUTED_KEY
}

// Each non-delegated session's issue set, keyed by session id, for its units to read.
function owner_sets(
	corpus: Corpus,
	meta: ReadonlyMap<string, SessionMeta>,
): Map<string, Set<number>> {
	const own = corpus.sessions.filter(
		(session) => meta.get(session.session_id)?.is_delegated !== true,
	)

	return new Map(own.map((session) => [session.session_id, issue_set(session.records)]))
}

// A session's records, each tagged with the issue its own branch names — and, for a delegated unit,
// the parent's sole issue substituted wherever the branch named none (joshuafolkken/kit#1812). A child
// that committed carries its own `<N>-` branch exactly as a top-level session does, so it attributes
// by its own records; only a sub-step that never commits — a review, a survey — carries `main`
// throughout and falls to the inherited issue. `inherited` is `UNATTRIBUTED_KEY` for a non-delegated
// session, which makes the substitution a no-op and leaves its branch-driven grouping exactly as before.
function pairs_with_inherited(
	session: SessionUsage,
	inherited: number,
	is_delegated: boolean,
): Array<AttributedRecord> {
	return cost_attribute.group_by_issue(session.records).flatMap((group) =>
		group.records.map((record) => ({
			record,
			issue: group.issue === cost_attribute.UNATTRIBUTED_KEY ? inherited : group.issue,
			baseline_tokens: session.baseline_tokens,
			session_id: session.session_id,
			is_delegated,
		})),
	)
}

const NO_ISSUES: ReadonlySet<number> = new Set()

// The issues the session that delegated this unit touched — or an empty set where the unit is not
// delegated, its parent is not in the corpus, or that parent named no issue. An empty set reads as
// "could belong to any issue", the honest candidate for a unit its parent gives nothing to place.
function parent_issues(
	session: SessionUsage,
	meta: ReadonlyMap<string, SessionMeta>,
	owners: ReadonlyMap<string, Set<number>>,
): ReadonlySet<number> {
	const entry = meta.get(session.session_id)

	if (entry?.is_delegated !== true) return NO_ISSUES

	return owners.get(entry.owner) ?? NO_ISSUES
}

interface SessionPairs {
	pairs: Array<AttributedRecord>
	// Present for a delegated unit whose cost could not all be attributed: the issues its parent
	// touched, which an issue scope counts as a floor when the set contains that issue or is empty.
	unattributed_candidates?: ReadonlySet<number>
}

function pairs_of_session(
	session: SessionUsage,
	meta: ReadonlyMap<string, SessionMeta>,
	owners: ReadonlyMap<string, Set<number>>,
): SessionPairs {
	const is_delegated = meta.get(session.session_id)?.is_delegated === true
	const candidates = parent_issues(session, meta, owners)
	const inherited = is_delegated ? sole_of(candidates) : cost_attribute.UNATTRIBUTED_KEY
	const pairs = pairs_with_inherited(session, inherited, is_delegated)
	const has_unattributed = pairs.some((pair) => pair.issue === cost_attribute.UNATTRIBUTED_KEY)

	if (!is_delegated || !has_unattributed) return { pairs }

	return { pairs, unattributed_candidates: candidates }
}

interface CorpusAttribution {
	pairs: Array<AttributedRecord>
	// One entry per delegated unit whose cost could not be attributed: the issues its parent touched.
	unattributed: Array<ReadonlySet<number>>
}

// Attribution across the whole corpus, delegated units followed to the session that delegated them
// (joshuafolkken/kit#1812). The fill-forward walk itself is untouched — a unit is tagged with its
// parent's issue and a non-delegated session keeps `group_by_issue` exactly as before — so
// `josh cost --issue` and `josh time`'s phase costs, which both read this, stay in step.
function attribute_corpus(corpus: Corpus): CorpusAttribution {
	const meta = session_meta(corpus)
	const owners = owner_sets(corpus, meta)
	const per_session = corpus.sessions.map((session) => pairs_of_session(session, meta, owners))

	return {
		pairs: per_session.flatMap((one) => one.pairs),
		unattributed: per_session.flatMap((one) =>
			one.unattributed_candidates === undefined ? [] : [one.unattributed_candidates],
		),
	}
}

// How many unattributed units an issue scope must treat as a floor: those whose parent touched that
// issue, and those whose parent named nothing (so the unit could belong to any issue).
function floor_for_issue(
	unattributed: ReadonlyArray<ReadonlySet<number>>,
	issue_number: number,
): number {
	return unattributed.filter((set) => set.size === 0 || set.has(issue_number)).length
}

// An occurrence carrying an issue beats one that does not. A copy written before the branch existed
// has nothing to attribute it to, so keeping it would move a real request into `unattributed`.
function is_better(candidate: AttributedRecord, existing: AttributedRecord): boolean {
	const { UNATTRIBUTED_KEY } = cost_attribute

	return existing.issue === UNATTRIBUTED_KEY && candidate.issue !== UNATTRIBUTED_KEY
}

function values_of(best: ReadonlyMap<string, AttributedRecord>): Array<AttributedRecord> {
	const collected: Array<AttributedRecord> = []

	for (const [, pair] of best) collected.push(pair)

	return collected
}

// **Dedupe again, across sessions.** Resuming or forking a session copies the earlier lines into a
// new transcript file, so one billed request appears in several — 152 such request ids in this
// repository's own transcripts, some in three files. Per-session dedup does not see them, and every
// scope spanning more than one session would bill those requests twice or three times.
function dedupe_across_sessions(pairs: ReadonlyArray<AttributedRecord>): Array<AttributedRecord> {
	const best = new Map<string, AttributedRecord>()

	for (const pair of pairs) {
		const existing = best.get(pair.record.request_id)

		if (existing === undefined || is_better(pair, existing)) {
			best.set(pair.record.request_id, pair)
		}
	}

	return values_of(best)
}

function attributed(corpus: Corpus): Array<AttributedRecord> {
	return dedupe_across_sessions(attribute_corpus(corpus).pairs)
}

// The in-scope records of each non-delegated (main-line) session, grouped and kept in the order they
// were read. The curve is built from these: a delegated unit starts from low context, so mixing its
// records into the positional quartiles breaks the growth curve a hand-off decision reads
// (joshuafolkken/kit#1853). A single-issue run on one session yields one group; a run resumed in a
// second session yields two, which the curve then withholds rather than mixing.
function mainline_records(pairs: ReadonlyArray<AttributedRecord>): Array<Array<UsageRecord>> {
	const groups = new Map<string, Array<UsageRecord>>()

	for (const pair of pairs) {
		if (pair.is_delegated) continue

		groups.set(pair.session_id, [...(groups.get(pair.session_id) ?? []), pair.record])
	}

	return [...groups.values()]
}

const cost_corpus = {
	accumulate_missing,
	load_corpus,
	attribute_corpus,
	floor_for_issue,
	dedupe_across_sessions,
	attributed,
	mainline_records,
}

export type { AttributedRecord, Corpus }
export { cost_corpus }

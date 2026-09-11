import { time_command_key } from './time-command-key'
import { time_format } from './time-format'
import { time_round_trips } from './time-round-trips'
import { time_spans, type Span } from './time-spans'

// What a run's turns were spent *on*, rather than how long they took (joshuafolkken/kit#1715).
//
// Every other block here measures duration, and `Round trips:` measures how often a run stopped.
// Neither can say what the stops were for — and for a `backlogrun` parent that is the only question
// worth asking, because the parent barely implements anything: it polls, it confirms children, it
// asks its loop what to do next, and it reads issues. joshuafolkken/kit#1567 measured 85% of a
// parent's billed input as carried conversation, and the carrying grows as n²/2 in the parent's own
// request count — so the parent's *turn count* is the distribution, and cutting it means knowing
// which kind of turn there are most of.
//
// **The turn is `time-round-trips.ts`'s, not a second definition.** `group_round_trips` returns one
// group per assistant message that issued at least one call, which is exactly the unit billed; a walk
// of its own here would be the clone `CLAUDE.md` prohibits, in the one place a drift would have two
// blocks of one report disagreeing about what a turn is.
//
// **The key is `time-command-key.ts`'s, for the same reason.** A turn's calls are named by the very
// keys the failure chain and the per-invocation table already use — `josh issue:state`, `Bash: gh`,
// `Read`, `Edit` — so a contributor is a set of those keys and nothing has to parse a command line
// twice.
//
// ## What it found, and what it cannot see
//
// Measured over the four recorded `backlogrun` parents — 414 turns — the largest contributor is
// `issue bookkeeping` at 110 turns (26.6%), of which the dominant shape is one issue read at a time:
// 19 `gh api repos/{owner}/{repo}/issues/<N>` calls and 5 `…/comments` calls, each its own turn.
// That is what `josh issue:read` exists to collapse.
//
// **A turn is attributed once, to the first contributor its calls match.** A turn that edits a file
// and also reads one is implementation, because the edit is what the turn was for. Attributing it
// twice would make the shares sum past the turn count and stop the block reconstructing it.
//
// **It says nothing about which turns were avoidable.** `Bundling:` answers that, and this block
// deliberately does not repeat it: a contributor being large is a reason to look, never a finding.

const { format_columns, format_share, unmeasured_row, SUFFIX_SEPARATOR } = time_format

const HEADING = 'Turns by contributor:'
const TURNS_NOTE = 'of the turns that issued a call'

// The eight kinds, in the precedence a turn is matched against them. **The order is the definition,
// not a display order**: implementation first because an edit is what its turn was for, then the
// dispatch of a child, then the three the parent loop is made of, then the reading around them.
const IMPLEMENTATION = 'implementation'
const DISPATCH = 'child dispatch'
const PROGRESS_POLL = 'progress polling'
const CHILD_CONFIRMATION = 'child confirmation'
const LOOP_ASK = 'loop asks'
const ISSUE_BOOKKEEPING = 'issue bookkeeping'
const INVESTIGATION = 'investigation'
// Everything the seven above did not claim. **Printed rather than dropped**, so the eight rows
// reconstruct the turn count and a growing `other` is visible as a gap in the enumeration.
const OTHER = 'other'

const NONE = 0
const ONE = 1

// The keys each contributor claims. A set per row rather than a regular expression, because the keys
// are a closed vocabulary `time-command-key.ts` already produces — matching them by pattern would
// claim a command nobody listed the first time one was named similarly.
const CONTRIBUTOR_KEYS: ReadonlyArray<readonly [string, ReadonlySet<string>]> = [
	[
		IMPLEMENTATION,
		new Set([
			'Edit',
			'Write',
			'NotebookEdit',
			'josh gate',
			'josh lint:related',
			'josh test:related',
			'josh test:unit',
			'josh test:e2e',
			'josh git',
			'josh followup',
		]),
	],
	[DISPATCH, new Set(['Agent', 'SendMessage', 'TaskStop', 'ListAgents'])],
	[PROGRESS_POLL, new Set(['josh run:progress', 'josh run:liveness'])],
	[
		CHILD_CONFIRMATION,
		new Set([
			'josh issue:state',
			'josh lane:list',
			'josh lane:open',
			'josh lane:close',
			'josh lane:prune',
			'josh run:preflight',
			'josh run:hold',
			'josh run:release',
			// The canonical name, not the `josh ms` a run actually types: since
			// joshuafolkken/kit#1789 the key carries the command an alias stands for.
			'josh main:sync',
		]),
	],
	[
		LOOP_ASK,
		new Set([
			'josh backlog:next',
			'josh backlog:budget',
			'josh backlog:plan',
			'josh epic:next',
			'josh epic:audit',
			'josh epic:check',
			'josh cost',
			'josh delegate',
			'josh eval:scope',
			'josh latest:scope',
			'josh release:scope',
			'josh review:brief',
			'josh review:round2',
		]),
	],
	[
		ISSUE_BOOKKEEPING,
		new Set([
			'Bash: gh',
			'josh epic',
			'josh epic:bundle',
			'josh issue:scout',
			'josh issue:read',
			'josh notify',
		]),
	],
	[
		INVESTIGATION,
		new Set([
			'Read',
			'Grep',
			'Glob',
			'Skill',
			'ToolSearch',
			'WebFetch',
			'WebSearch',
			'Bash: cat',
			'Bash: grep',
			'Bash: rg',
			'Bash: sed',
			'Bash: head',
			'Bash: tail',
			'Bash: ls',
			'Bash: find',
			'Bash: wc',
			'Bash: awk',
			'Bash: jq',
		]),
	],
]

const CONTRIBUTOR_NAMES: ReadonlyArray<string> = [...CONTRIBUTOR_KEYS.map(([name]) => name), OTHER]

// What the walk established. **`is_measured` is not `turn_count > 0`**: a scope whose transcript was
// never read and a scope that made no call both total zero, and printing the same rows for the two
// would report the second as though it had been read — the same distinction `time-single-checks.ts`
// draws for its own counts.
interface ParentTurnTotals {
	turn_count: number
	// **A plain record rather than a `Map`**, because `josh time --json` is what the `diag` skill reads
	// and `JSON.stringify` renders a `Map` as `{}` — the whole breakdown would have been lost on the
	// one path that consumes it programmatically. A contributor that claimed no turn is absent rather
	// than zero; the renderer defaults it, and `is_measured` is what says whether zero means anything.
	by_contributor: Readonly<Record<string, number>>
	is_measured: boolean
}

const NO_PARENT_TURNS: ParentTurnTotals = {
	turn_count: NONE,
	by_contributor: {},
	is_measured: false,
}

// Which contributor this turn belongs to. The first row whose set holds any of the turn's keys, so a
// turn that edited and also read is implementation rather than both.
function contributor_of(keys: ReadonlyArray<string>): string {
	const matched = CONTRIBUTOR_KEYS.find(([, claimed]) => keys.some((key) => claimed.has(key)))

	return matched === undefined ? OTHER : matched[0]
}

function turn_keys(trip: ReadonlyArray<Span>): Array<string> {
	return trip.map((span) => time_command_key.command_key(span))
}

function count_turn(counts: Map<string, number>, trip: ReadonlyArray<Span>): void {
	const contributor = contributor_of(turn_keys(trip))

	counts.set(contributor, (counts.get(contributor) ?? NONE) + ONE)
}

function build_parent_turns(spans: ReadonlyArray<Span>): ParentTurnTotals {
	const trips = time_round_trips.group_round_trips(spans)
	const counts = new Map<string, number>()

	// A loop rather than `reduce`, which this project's lint config forbids.
	for (const trip of trips) {
		count_turn(counts, trip)
	}

	return {
		turn_count: trips.length,
		by_contributor: Object.fromEntries(counts),
		is_measured: time_spans.has_transcript_data(spans.length),
	}
}

// Read through one function so the record's dynamic key is looked up in exactly one place.
function count_for(totals: ParentTurnTotals, name: string): number {
	return Object.hasOwn(totals.by_contributor, name) ? (totals.by_contributor[name] ?? NONE) : NONE
}

function contributor_row(totals: ParentTurnTotals, name: string): string {
	const count = count_for(totals, name)
	const share = format_share(count, totals.turn_count)

	return format_columns(name, String(count), [share, TURNS_NOTE].join(SUFFIX_SEPARATOR))
}

// **A run whose transcript was not read says so rather than reporting eight zeros.** Zero here would
// read as a run that made no turn of that kind, which is the one answer an unread transcript cannot
// support — the same word every block above it uses.
function parent_turn_lines(totals: ParentTurnTotals): Array<string> {
	const heading = ['', HEADING]

	if (!totals.is_measured) {
		return [...heading, ...CONTRIBUTOR_NAMES.map((name) => unmeasured_row(name))]
	}

	return [...heading, ...CONTRIBUTOR_NAMES.map((name) => contributor_row(totals, name))]
}

const time_parent_turns = {
	HEADING,
	IMPLEMENTATION,
	DISPATCH,
	PROGRESS_POLL,
	CHILD_CONFIRMATION,
	LOOP_ASK,
	ISSUE_BOOKKEEPING,
	INVESTIGATION,
	OTHER,
	CONTRIBUTOR_NAMES,
	NO_PARENT_TURNS,
	build_parent_turns,
	contributor_of,
	count_for,
	parent_turn_lines,
}

export type { ParentTurnTotals }
export { time_parent_turns }

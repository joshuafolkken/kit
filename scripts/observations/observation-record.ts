import { observation_ledger_home } from './observation-ledger-home'
import { observation_ledger_line } from './observation-ledger-line'

// The count, the append and the promotion verdict of one observation-ledger sighting, as one command.
// They were a `cat | grep -c … || true` a run typed by hand, an append it
// wrote itself, and a "does the count answer exactly 1" it judged — three steps whose answers are
// fixed, now read off the ledger rather than re-derived in every run. The grammar and the promotion
// rule are `.claude/skills/workflow-commands/observation-ledger.md`'s.

const FILE_VERDICT = 'file'
const LEDGER_VERDICT = 'ledger'
const REFUSED_VERDICT = 'refused'
// The sample line in `observation-ledger.md` carries it, so a real sighting under it would be counted
// against the sample.
const RESERVED_SLUG = 'example'
const RESERVED_REASON = '`k:example` is reserved for the sample in observation-ledger.md'
// The one earlier sighting that makes this one the second — a higher count means the sighting that
// answered `1` already filed the Issue.
const PROMOTING_COUNT = 1

interface ObservationEntry {
	slug: string
	depth: string
	where: string
	what: string
}

interface RecordRequest {
	entry: ObservationEntry
	checkout: string
	now: Date
}

type RecordResult =
	| { verdict: typeof REFUSED_VERDICT; reason: string }
	| {
			verdict: typeof FILE_VERDICT | typeof LEDGER_VERDICT
			earlier: ReadonlyArray<string>
			line: string
			target: string
	  }

function entry_line(entry: ObservationEntry, date: string): string {
	return `- k:${entry.slug} | ${entry.depth} | ${date} | ${entry.where} | ${entry.what}`
}

function refusal_of(entry: ObservationEntry, line: string): string | undefined {
	if (entry.slug === RESERVED_SLUG) return RESERVED_REASON

	return observation_ledger_line.line_reason(line)
}

// Every ledger line already carrying the key, across every file — a recurrence is a recurrence
// whichever issue's file each sighting sits in. No ledger at all is a first sighting.
function sightings(ledger: string | undefined, slug: string): ReadonlyArray<string> {
	const prefix = `- k:${slug} |`

	return (ledger ?? '').split('\n').filter((line) => line.startsWith(prefix))
}

// The count is read before the append, so it is the sightings *before* this one.
async function record(request: RecordRequest): Promise<RecordResult> {
	const date = observation_ledger_home.ledger_date(request.now)
	const line = entry_line(request.entry, date)
	const reason = refusal_of(request.entry, line)

	if (reason !== undefined) return { verdict: REFUSED_VERDICT, reason }

	const earlier = sightings(
		await observation_ledger_home.read(request.checkout),
		request.entry.slug,
	)
	const target = await observation_ledger_home.writer_path(request.now, request.checkout)

	await observation_ledger_home.append(target, [line])

	const verdict = earlier.length === PROMOTING_COUNT ? FILE_VERDICT : LEDGER_VERDICT

	return { verdict, earlier, line, target }
}

const observation_record = { record }

export {
	FILE_VERDICT,
	LEDGER_VERDICT,
	observation_record,
	REFUSED_VERDICT,
	type ObservationEntry,
	type RecordResult,
}

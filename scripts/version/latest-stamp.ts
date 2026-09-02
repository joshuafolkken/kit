import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { stamp_file } from '#scripts/josh/stamp-file'

// When `josh latest` last finished in this checkout, and whether that is recent enough to skip
// (joshuafolkken/kit#1215).
//
// `josh latest` is a network-bound chain — corepack, every dependency, `ranges`, `pnpm audit` — that
// took 60–120 seconds at the head of every `fullrun` / `halfrun` and of every child a batch ran, and
// running it several times in one day barely changes its answer. `queue` and `epicrun` had already
// hoisted it to the head of a batch by hand; what had no rule at all was a standalone run, which is
// its own batch head and therefore updated dependencies every single time.
//
// **The condition is elapsed time, not judgement.** "The deps are probably still fresh" is a call
// made under time pressure, and time pressure resolves it toward `skip` exactly when a stale
// dependency is most likely to matter — the same reason `pnpm josh review:level` and
// `pnpm josh eval:scope` take their answers off a mechanical input rather than out of an agent's
// head. The record here is that input.

const STAMP_PREFIX = 'josh-latest-stamp-'
// Twelve hours rather than a day. The issue's own measurement is that a day's worth of runs get
// nearly the same answer, so the saving between the two settings is marginal, while the exposure is
// not: a repository that publishes several times a day would spend a whole day on dependencies
// nobody had re-read. Two windows a day keeps the update at a frequency a person would recognize and
// still takes it off all but the first run of a working session. `JOSH_LATEST_MAX_AGE_HOURS` moves
// it in either direction.
const DEFAULT_MAX_AGE_HOURS = 12
const MAX_AGE_ENV_VAR = 'JOSH_LATEST_MAX_AGE_HOURS'
const MS_PER_HOUR = 3_600_000

interface LatestStamp {
	ran_at: string
}

// Keyed to the **project**, not to the kit package. A globally installed `josh` has one package
// directory for every project on the machine, so keying on that would let `josh latest` in one
// project answer `skip` in another for the rest of the window — skipping its `pnpm audit` too. This
// is where the record differs from `josh eval`'s, which is genuinely about the package's own files.
function stamp_path(): string {
	return stamp_file.stamp_path(STAMP_PREFIX, PROJECT_ROOT)
}

// Anything that is not a positive finite number falls back to the default, the same reading
// `JOSH_CI_TIMEOUT_SECONDS` gets: a misspelled value must not silently disable the update, and a
// zero or negative window would ask for it on every run while looking like a configured choice.
function read_max_age_hours(environment: NodeJS.ProcessEnv = process.env): number {
	const raw = Number(environment[MAX_AGE_ENV_VAR])

	return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_MAX_AGE_HOURS
}

// Takes `unknown` rather than the declared field type: the file is written by one command and read
// by another, so a truncated or hand-edited one has to answer "no record" rather than reach the
// comparison as a lie.
function parse_stamp(raw: string): LatestStamp | undefined {
	const { ran_at } = JSON.parse(raw) as Partial<LatestStamp>

	if (typeof ran_at !== 'string' || Number.isNaN(Date.parse(ran_at))) return undefined

	return { ran_at }
}

function read_stamp(source: string = stamp_path()): LatestStamp | undefined {
	const raw = stamp_file.read_stamp_text(source)

	if (raw === undefined) return undefined

	try {
		return parse_stamp(raw)
	} catch {
		return undefined
	}
}

function write_stamp(target: string = stamp_path()): string {
	const stamp: LatestStamp = { ran_at: new Date().toISOString() }

	return stamp_file.write_stamp(target, stamp)
}

// Negative where the record is in the future — a clock that moved backwards, or a record copied from
// another machine.
function hours_since(stamp: LatestStamp, now: Date = new Date()): number {
	return (now.getTime() - Date.parse(stamp.ran_at)) / MS_PER_HOUR
}

// **The window is measured in both directions.** A record a little ahead of now is the ordinary
// small clock skew, and reading it as stale would update on every invocation until the clock caught
// up — the failure this command exists to remove. A record *far* ahead is a different thing: a stamp
// written under a badly skewed clock, or copied from another machine, would otherwise answer `skip`
// for as long as that checkout exists and silently switch dependency updates off. Distance from now
// is what separates them, so the reading is the absolute one.
function is_fresh(stamp: LatestStamp, now: Date = new Date(), max_age_hours?: number): boolean {
	return Math.abs(hours_since(stamp, now)) < (max_age_hours ?? read_max_age_hours())
}

const latest_stamp = {
	DEFAULT_MAX_AGE_HOURS,
	hours_since,
	is_fresh,
	MAX_AGE_ENV_VAR,
	read_max_age_hours,
	read_stamp,
	stamp_path,
	write_stamp,
}

export type { LatestStamp }
export { latest_stamp }

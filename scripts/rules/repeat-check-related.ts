import type { GuardRun } from '#scripts/josh/hook-decision'
import { time_density_hook } from '#scripts/time-runtime/time-density-hook'
import { bash_triggers } from './bash-triggers'
import { round_one_check_related } from './round-one-check-related'

// A lane child runs the full-reach `check:related` once before its review brief, never again mid-run.
//
// **Mid-run checks are one check by name.** The #5630 lane ran `check:related` four times while
// implementing, 7.0 of its 29.4 implement minutes; each run re-reads the whole related reach, while a
// mid-run question is answered by `check:related --touched`, or by `lint:related`,
// `test:related --touched` or `cspell:dot` alone; a `--touched` run is never counted. The
// brief then needs `lint:related` and `test:related` green on its tree (`scoped-green.ts`), which a
// re-run of the failing one gives.
//
// **The material is the run's own calls, read off the transcript tail** — the same events
// `round-one-check-related` reads, where a `check` is a call that came back with no refusal: the call being
// decided is already in the transcript, and a reissue after another guard's refusal is still the first.
// A count restarts at a join or `ship --detach`, after which the tree has moved under the review or a
// stopped ship; a brief hands the question to `round-one-check-related`.

// Whether a `check:related` already ran since the last join or detach, with no brief after it.
function repeats_before_brief(tail: string): boolean {
	const events = round_one_check_related.round_events(tail)
	const since_close = events.slice(events.lastIndexOf('close') + 1)

	if (since_close.includes('brief')) return false

	return since_close.includes('check')
}

// Refused on every occurrence: the way on is one check by name, never a reissue.
function decide(_call: unknown, run: GuardRun): boolean {
	return repeats_before_brief(time_density_hook.read_tail(run.transcript))
}

const REPEAT_CHECK_RELATED_REASON =
	'⛔ repeat check:related: the full-reach `check:related` runs once before the brief; refused on every ' +
	'later occurrence. Mid-run, run `pnpm josh check:related --touched` (never refused), or the ' +
	'failing check by name — `pnpm josh lint:related`, `check`, `test:related` (`--touched` mid-run), ' +
	'`cspell:dot` — then `pnpm josh run:review` ' +
	'(`.claude/skills/workflow-commands/chain-rule.md` → "A lane child").'

// It declares no `keeps`: skipping the check is the absence of a call, so the row is reported
// unmeasured rather than scored on an act that does not exist (`lane-split-park.ts`).
const ROW = {
	id: 'repeat-check-related',
	is_trigger: bash_triggers.on_bash_command(round_one_check_related.is_full_reach_candidate),
	reason: REPEAT_CHECK_RELATED_REASON,
	decide,
	about: {
		title: 'One check:related before the brief',
		topic: '`.claude/skills/workflow-commands/chain-rule.md` → "A lane child"',
		fires:
			'`pnpm josh check:related` (`josh cr`) in a lane child after an earlier one that ran, with no `run:review` (or `run:chain`) brief, join or `ship --detach` since. Every occurrence',
		quiet:
			'the first since the last join or detach, a brief since, a `--touched` run, or not a lane child',
	},
}

const repeat_check_related = {
	REPEAT_CHECK_RELATED_REASON,
	ROW,
	repeats_before_brief,
}

export { repeat_check_related }

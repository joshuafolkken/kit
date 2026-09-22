import { repo_party } from '#scripts/discovery/repo-party'
import { bash_triggers } from './bash-triggers'
import { gh_api } from './gh-api'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `third-party-write` row of `delivered-rules.ts`
// (joshuafolkken/kit#2122). A `gh api` write to a repository whose owner is not this session's — a
// tracker we do not own — is Tier C: `CLAUDE.md` → "Third-party repositories are Tier C" and
// `upstream-interrupt.md` forbid it without explicit current-turn user instruction, and a correct
// diagnosis is not that instruction.
//
// **What the deny list could not express.** A glob keys on a literal, and "the owner in this path is
// not the session's owner" is not one — it is a comparison against the session's own remote. Reading
// the command's `repos/<owner>/<repo>` path and computing the party is what makes the judgement
// independent of the spelling, the same move `git-force.ts` makes for a force push.
//
// **It fires on every occurrence, not once per run.** Publishing to another owner's tracker is
// irreversible every time, so refused-once-and-free-after would put the second write back on the
// run's self-restraint — the disposition `git-force.ts` and `file-body.ts` take for the same reason.
//
// **A read passes untouched; only a write is refused.** `gh api …/repos/other/repo/issues/5` with no
// field flag is a `GET`, which reads someone else's tracker without changing it — no rule of ours
// forbids that. The trigger asks `gh_api.is_write`, so it is silent on every read.

// A third-party write means all three: a `gh api` call, a write, and a repository target whose owner
// the classification calls third-party. `unknown` (an unreadable session remote, an unparseable path)
// is not third-party — the rule stays silent rather than refusing a write it cannot prove is external.
function is_third_party_write_segment(segment: string, session_owner: string | undefined): boolean {
	if (!gh_api.is_gh_api(segment) || !gh_api.is_write(segment)) return false

	const target = gh_api.repo_target(segment)

	if (target === undefined) return false

	return repo_party.classify(session_owner, target.owner) === repo_party.THIRD_PARTY
}

// The session owner is read only when a segment is actually a `gh api` write to a repository — so an
// ordinary shell line, and every read, pays nothing for the local config read. `resolve_owner` is
// injected so the suite fixes the owner without touching the real remote, the way `file-body.ts`
// injects `has_file`. Each segment is judged on its own, so a `gh api` write quoted inside another
// command's argument is read as the write it is not, exactly as every other trigger here reads its own.
function writes_third_party(
	command: string,
	resolve_owner: () => string | undefined = repo_party.current_owner,
): boolean {
	const targets = shell_segments
		.segments_of(command)
		.filter((segment) => gh_api.is_gh_api(segment) && gh_api.is_write(segment))

	if (targets.length === 0) return false

	const session_owner = resolve_owner()

	return targets.some((segment) => is_third_party_write_segment(segment, session_owner))
}

// The instruction in the shape a refusal can carry: what the command does, why it is Tier C, and what
// to do instead. The command that computes the party is handed over, because the whole point of this
// Issue is that the test is computed rather than judged.
const THIRD_PARTY_WRITE_REASON =
	'⛔ third-party write: this `gh api` call writes to a repository whose owner is not this session — ' +
	'a tracker we do not own is Tier C, and every write there (Issue, comment, PR, Discussion, review) ' +
	'needs explicit current-turn user instruction; typing the target, or holding a correct diagnosis, ' +
	'is not that instruction (`CLAUDE.md` → "Third-party repositories are Tier C", ' +
	'`prompts/collaboration-workflow/upstream-interrupt.md`). Confirm the party with ' +
	'`pnpm josh repo:party <owner/repo>` — owner equality, computed not judged. A read (`-X GET`, or no ' +
	'field flag) passes untouched; only a write (`-f`/`-F`/`--field`/`--raw-field`/`--input`, or ' +
	'`-X POST|PATCH|PUT|DELETE`) is refused. Record the finding on our own Issue and draft the artifact ' +
	'for a person to post — do not publish it yourself. **This rule fires on every occurrence, not once ' +
	'per run.**'

// `decide` returns true so it refuses every occurrence; it declares no `keeps` — not writing to
// another owner's tracker is the absence of a call, not a call, so the row is reported unmeasured
// rather than scored on an act that does not exist (`git-force.ts`).
const ROW = {
	id: 'third-party-write',
	is_trigger: bash_triggers.on_bash_command((command: string) => writes_third_party(command)),
	reason: THIRD_PARTY_WRITE_REASON,
	decide: (): boolean => true,
}

const third_party_write = {
	ROW,
	THIRD_PARTY_WRITE_REASON,
	is_third_party_write_segment,
	writes_third_party,
}

export { third_party_write }

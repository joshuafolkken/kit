import { repo_party } from '#scripts/discovery/repo-party'
import { bash_triggers } from './bash-triggers'
import { gh_api } from './gh-api'
import { gh_repo_selector } from './gh-repo-selector'
import { git_argv } from './git-argv'
import { pr_merge } from './pr-merge'
import { repo_admin } from './repo-admin'
import { shell_segments } from './shell-segments'

// The trigger and the delivered text behind the `third-party-write` row of `delivered-rules.ts`.
// A `gh api` write to a repository whose owner is not this session's — a
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
// The `{owner}` placeholder is judged by every owner `gh` could expand it to:
// first-party only when all of them are, so a fork checkout whose `upstream` is another owner's still
// refuses the write `gh` may send there. A candidate whose owner could not be read counts as
// third-party here — unlike an unreadable session owner, it is a remote `gh` may really write to.
function is_third_party_write_segment(
	segment: string,
	session_owner: string | undefined,
	resolve_placeholder_owners: () => Array<string | undefined>,
): boolean {
	if (!gh_api.is_gh_api(segment) || !gh_api.is_write(segment)) return false

	const target = gh_api.repo_target(segment)
	if (target === undefined) return false

	if (!gh_api.is_owner_placeholder(target.owner)) {
		return repo_party.classify(session_owner, target.owner) === repo_party.THIRD_PARTY
	}

	return resolve_placeholder_owners().some(
		(owner) =>
			owner === undefined || repo_party.classify(session_owner, owner) === repo_party.THIRD_PARTY,
	)
}

// A segment that makes `gh` resolve the placeholder against something other than this process's
// checkout: a directory change, or a `GH_REPO` assignment. The guard reads the hook's own cwd and
// environment, so after either one its candidate set no longer describes what `gh` will expand.
const GH_CONTEXT_CHANGE = /(?:^|\s)(?:cd|pushd)(?:\s|$)|(?:^|\s)(?:export\s+)?GH_REPO=/u

function unreadable_candidates(): Array<string | undefined> {
	return [undefined]
}

// The placeholder candidates for the segment at `index`: the checkout's own, unless an earlier
// segment of the same line moved `gh` elsewhere — then one unreadable candidate, refused.
function candidates_at(
	segments: ReadonlyArray<string>,
	index: number,
	resolve_placeholder_owners: () => Array<string | undefined>,
): () => Array<string | undefined> {
	const has_moved = segments.slice(0, index).some((segment) => GH_CONTEXT_CHANGE.test(segment))

	return has_moved ? unreadable_candidates : resolve_placeholder_owners
}

// A merge or an administration write is refused by its own row whoever owns the target, and one
// refusal is what a PreToolUse hook carries — so the two readings this row added for
// joshuafolkken/kit#4659 leave those to the row that names them. Asked only of a candidate, so an
// ordinary shell line pays nothing for it.
function is_claimed_by_narrower_row(command: string): boolean {
	return pr_merge.is_pr_merge(command) || repo_admin.is_repo_admin_write(command)
}

// **A GraphQL mutation names no repository this guard can read** (joshuafolkken/kit#4659): its target
// is a node id inside the body, so it is refused whoever owns the session — the disposition
// `pr-merge.ts` takes for a GraphQL body it cannot read, which that row already refuses for a body
// read from a file or computed by the shell. A query passes. The keyword is looked for in the whole
// line, because the segment cut ignores quotes and a multi-line query splits across it. A query field
// the shell expands (`query="$Q"`, or the whole argument quoted: `"query=$Q"`) hides its keyword the
// same way, so it is refused as a mutation; a single-quoted `query='query($o: String!) {…}'` is
// literal and still read. A body read from a file is `pr-merge.ts`'s, which refuses it already.
const GRAPHQL_MUTATION = /\bmutation\b/u
const EXPANDED_QUERY = /^(?:-[fF])?"?query=(?!')[\s\S]*\$/u

function is_hidden_or_mutation(command: string, args: ReadonlyArray<string>): boolean {
	return GRAPHQL_MUTATION.test(command) || args.some((argument) => EXPANDED_QUERY.test(argument))
}

// The arguments of a `gh api` GraphQL call, or `undefined` when the segment is not one.
function graphql_args(segment: string): ReadonlyArray<string> | undefined {
	const call = git_argv.program_of(segment)

	if (call === undefined || !gh_api.is_gh_api(segment)) return undefined

	return pr_merge.is_graphql_call(call.name, call.args) ? call.args : undefined
}

function is_graphql_mutation(command: string, segment: string): boolean {
	const args = graphql_args(segment)

	if (args === undefined) return false

	return is_hidden_or_mutation(command, args) && !is_claimed_by_narrower_row(command)
}

// **A `gh <group> <action> -R <owner>/<repo>` write is judged by its selector** (kit#4659).
// A selector whose owner cannot be read (`-R "$REPO"`) is refused, like an unreadable placeholder
// candidate: it is a repository `gh` really writes to.
function is_third_party_selector_write(
	command: string,
	segments: ReadonlyArray<string>,
	index: number,
	session_owner: string | undefined,
): boolean {
	const selectors = gh_repo_selector.write_selectors(segments, index)
	const is_third_party = selectors.some((selector) => {
		const owner = repo_party.selector_owner(selector)

		return (
			owner === undefined || repo_party.classify(session_owner, owner) === repo_party.THIRD_PARTY
		)
	})

	return is_third_party && !is_claimed_by_narrower_row(command)
}

function is_owner_dependent_write(segments: ReadonlyArray<string>, index: number): boolean {
	const segment = segments[index] ?? ''

	if (gh_api.is_gh_api(segment)) return gh_api.is_write(segment)

	return gh_repo_selector.write_selectors(segments, index).length > 0
}

function writes_to_third_party_owner(
	command: string,
	segments: ReadonlyArray<string>,
	resolve_owner: () => string | undefined,
	resolve_placeholder_owners: () => Array<string | undefined>,
): boolean {
	if (segments.every((_segment, index) => !is_owner_dependent_write(segments, index))) return false

	const session_owner = resolve_owner()

	return segments.some(
		(segment, index) =>
			is_third_party_selector_write(command, segments, index, session_owner) ||
			is_third_party_write_segment(
				segment,
				session_owner,
				candidates_at(segments, index, resolve_placeholder_owners),
			),
	)
}

// The session owner is read only when a segment is actually a repository write — so an ordinary shell
// line, and every read, pays nothing for the local config read. `resolve_owner` and
// `resolve_placeholder_owners` are injected so the suite fixes the owners without touching the real
// remotes, the way `file-body.ts` injects `has_file`. Each segment is judged on its own, so a `gh api`
// write quoted inside another command's argument is read as the write it is not, exactly as every
// other trigger here reads its own. The cut is by program — a pipe and a background `&` cut too, a
// quoted one does not — after joining backslash-continued lines, so `echo hi | gh pr comment …` and a
// `gh api graphql \⏎ -f query=…` are each read as the one `gh` call they launch.
function writes_third_party(
	command: string,
	resolve_owner: () => string | undefined = repo_party.current_owner,
	resolve_placeholder_owners: () => Array<string | undefined> = repo_party.placeholder_owners,
): boolean {
	const segments = shell_segments.quote_aware_commands_of(
		shell_segments.joined_continuations(command),
	)

	if (segments.some((segment) => is_graphql_mutation(command, segment))) return true

	return writes_to_third_party_owner(command, segments, resolve_owner, resolve_placeholder_owners)
}

// The instruction in the shape a refusal can carry: what the command does, why it is Tier C, and what
// to do instead. The command that computes the party is handed over, because the whole point of this
// Issue is that the test is computed rather than judged.
const THIRD_PARTY_WRITE_REASON =
	"⛔ third-party write: this `gh` call writes to another owner's repository, or one it cannot " +
	'read (a GraphQL mutation, an unreadable `-R`) — Tier C. Check `pnpm josh repo:party ' +
	'<owner/repo>`; first-party, use a REST `repos/<owner>/<repo>` path. Else record it on our ' +
	'Issue and draft it for a person to post. Fires on every occurrence (`upstream-interrupt.md`).'

// `decide` returns true so it refuses every occurrence; it declares no `keeps` — not writing to
// another owner's tracker is the absence of a call, not a call, so the row is reported unmeasured
// rather than scored on an act that does not exist (`git-force.ts`).
const ROW = {
	id: 'third-party-write',
	is_trigger: bash_triggers.on_bash_command((command: string) => writes_third_party(command)),
	reason: THIRD_PARTY_WRITE_REASON,
	decide: (): boolean => true,
	about: {
		title: 'Third-party write',
		topic: '`upstream-interrupt.md`',
		fires:
			'a `gh api` write (field flag or a write method) or a `gh <group> <action>` write selected by `-R` / `GH_REPO` to a repository whose owner is not this session, or a `gh api graphql` call whose line names `mutation` or whose query the shell expands, outside the merge and administration rows. Every occurrence',
		quiet:
			'a read, a GraphQL query, or a first-party owner (pinned at session start, `pnpm josh repo:party`)',
	},
}

const third_party_write = {
	ROW,
	THIRD_PARTY_WRITE_REASON,
	writes_third_party,
}

export { third_party_write }

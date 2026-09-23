import { repo_party } from '#scripts/discovery/repo-party'
import { issue_citation } from './issue-citation'

// The predicates behind the `filing-offer` row of the stop guard (joshuafolkken/kit#2422).
//
// **A first-party filing is Tier A, and an offer to file is that filing deferred to the user.**
// `SKILL.md` → §2i says a run that judges something worth filing files it without asking, yet a reply
// can still end on "it is worth filing — say so if you want it filed". The rule was resident; what was
// missing was anything that fired at the moment of hesitation. That moment is one `Stop` payload: a
// reply that offers to file, on a turn that filed nothing.
//
// **The detection is tightened the way `issue-citation.ts` is**, because a block costs a turn: only
// the run's own prose is read (`issue_citation.prose_lines` — no fenced example, no quote line), and
// only a phrase that *asks* is matched. A reply reporting a filing ("Filed …", or its Japanese past
// tense) carries no asking phrase, and a filing already on the transcript tail stands the row down
// regardless of wording.
//
// **A third-party target is never pushed toward a filing.** It is Tier C (`CLAUDE.md` → "Third-party
// repositories are Tier C"), so any `owner/repo` the reply names whose owner is not the session's —
// `repo_party.classify`, the one definition `josh repo:party` reads — keeps the row silent, and so
// does a session owner that cannot be read. The failure direction is a missed nudge, never a Tier C
// write prompted by the hook.

// The phrases that offer a filing rather than report one. Japanese first — the session language —
// then English. Each asks for permission, proposes, or judges the filing appropriate without making it.
const OFFER_PATTERNS: ReadonlyArray<RegExp> = [
	/起票(?:して)?(?:も)?(?:よければ|よろしければ|よいですか|良いですか|よろしいですか|いいですか)/u,
	/起票(?:しましょうか|しますか|するのが妥当|すべきだと|すべきと|を提案|をご提案)/u,
	/Issue\s*[化に](?:しましょうか|しますか|してよければ)/iu,
	/\b(?:shall|should)\s+I\s+(?:file|open|raise)\b/iu,
	/\b(?:want|like)\s+me\s+to\s+(?:file|open|raise)\b/iu,
	/\blet\s+me\s+know\s+if\s+you\s+(?:want|would\s+like)\s+(?:me\s+to\s+file|it\s+filed)\b/iu,
]

// A GitHub URL's owner, as group 1. The qualified `owner/repo#N` spelling is read by
// `issue_citation.bare_references` instead, whose backward prefix scan stays linear.
const GITHUB_URL_OWNER = /github\.com\/([\w.-]+)\//gu
const OWNER_SEPARATOR = '/'

function is_offer_line(line: string): boolean {
	return OFFER_PATTERNS.some((pattern) => pattern.test(line))
}

// Whether the run's own prose offers to file an Issue instead of filing it.
function offers_filing(message: string): boolean {
	return issue_citation.prose_lines(message).some((line) => is_offer_line(line))
}

function url_owners(message: string): ReadonlyArray<string> {
	return [...message.matchAll(GITHUB_URL_OWNER)].map((match) => match[1] ?? '')
}

// The owners of the qualified `owner/repo#N` references the prose writes out.
function qualified_owners(message: string): ReadonlyArray<string> {
	return issue_citation
		.bare_references(message)
		.filter((reference) => reference.includes(OWNER_SEPARATOR))
		.map((reference) => reference.split(OWNER_SEPARATOR)[0] ?? '')
}

// Every repository owner the reply names, from either spelling.
function mentioned_owners(message: string): ReadonlyArray<string> {
	return [...url_owners(message), ...qualified_owners(message)]
}

// Whether the filing the reply offers targets a first-party repository: the session owner is readable
// and every owner the reply names is it. A reply naming no repository offers a filing here, which is
// first-party by definition once the session owner is known. The whole reply is read, not the offer
// line alone: Japanese prose names the target on one line and asks on the next, and reading only the
// ask would push a Tier C filing — so a third-party link cited as context costs a missed nudge instead.
function is_first_party_target(message: string, session_owner: string | undefined): boolean {
	if (session_owner === undefined) return false

	return mentioned_owners(message).every(
		(owner) => repo_party.classify(session_owner, owner) === repo_party.FIRST_PARTY,
	)
}

const filing_offer = { is_first_party_target, mentioned_owners, offers_filing }

export { filing_offer }

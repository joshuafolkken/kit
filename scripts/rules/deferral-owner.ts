import { filing_offer } from './filing-offer'
import { issue_citation } from './issue-citation'

// The predicates behind the `deferral-owner` row of the stop guard (joshuafolkken/kit#8296).
//
// **A deferral nobody owns is a decision dropped.** `principles.md` → "concise-reply" says a reply that
// recommends deciding, investigating or filing later names, in the same reply, the Issue that carries it
// (`#N`, or a filing draft) or the reason it is not tracked. A consultation reply once ended on "decide
// after the measurement" and "file it when the cause shows" with neither, and the two points belonged to
// nobody until the user noticed. The rule alone did not hold at that moment; this row reads the reply.
//
// **Read the way `filing-offer.ts` reads**: only the run's own prose (`issue_citation.prose_lines` — no
// fenced example, no quote line), and an owner counts only in the deferring paragraph, so an `#N` cited
// for something else further down does not excuse it. **A third-party target is never pushed toward a
// filing**: the row is silent unless `filing_offer.is_first_party_target` holds for the whole reply.

// The phrases that put a decision, an investigation or a filing off to later. Japanese first — the
// session language — then English.
const DEFERRAL_PATTERNS: ReadonlyArray<RegExp> = [
	/(?:見て|待って|確かめて|分かって)から(?:決め|判断|起票)/u,
	/(?:その時|そのとき|その際|時期が来たら)に?(?:起票|判断|決め)/u,
	/(?:後で|あとで|改めて|後日)(?:判断|決め|起票|調べ|調査)/u,
	/\b(?:decide|file\s+it|investigate|revisit\s+(?:it|this))\s+later\b/iu,
	/\b(?:decide|file\s+it)\s+(?:once|when|after)\b/iu,
]

// What makes a deferring paragraph owned: an Issue reference, a filing draft, or a stated reason not to track.
const OWNER_PATTERNS: ReadonlyArray<RegExp> = [
	/#\d+|\/issues\/\d+/u,
	/起票案|タイトル案|\b(?:filing|issue)\s+draft\b|\bdraft\s+(?:issue|title)\b/iu,
	/追わない|起票しない|対応しない|見送る/u,
	/\bnot\s+(?:worth\s+)?track(?:ing|ed)?\b|\bno\s+follow-?up\b/iu,
]

const REASON =
	'⛔ deferral owner: your reply recommends deciding, investigating or filing later, and that paragraph ' +
	'names no Issue to carry it. In the same paragraph add the owning `#N`, a filing draft (a consultation ' +
	'session waits for the instruction to file), or the reason it is not tracked; a start condition is a ' +
	'blocked-by or start-condition declaration (`principles.md` → "concise-reply"). Do not repeat the rest ' +
	'of your previous reply.'

function matches_any(text: string, patterns: ReadonlyArray<RegExp>): boolean {
	return patterns.some((pattern) => pattern.test(text))
}

// The prose split at blank lines, each paragraph joined back into one string.
function paragraphs(message: string): ReadonlyArray<string> {
	return issue_citation
		.prose_lines(message)
		.join('\n')
		.split(/\n\s*\n/u)
}

function is_unowned_deferral(paragraph: string): boolean {
	return matches_any(paragraph, DEFERRAL_PATTERNS) && !matches_any(paragraph, OWNER_PATTERNS)
}

// Whether the reply's own prose recommends a deferral with no owning Issue and no reason not to track it.
function has_unowned_deferral(message: string): boolean {
	return paragraphs(message).some((paragraph) => is_unowned_deferral(paragraph))
}

// The row's whole judgement: an unowned deferral, toward a first-party repository.
function needs_owner(message: string, session_owner: string | undefined): boolean {
	if (!has_unowned_deferral(message)) return false

	return filing_offer.is_first_party_target(message, session_owner)
}

const deferral_owner = { REASON, needs_owner }

export { deferral_owner }

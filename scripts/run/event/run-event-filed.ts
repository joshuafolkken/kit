import { issue_cite } from '#scripts/issue/issue-cite'
import {
	BREAKING_CHANGE_LABEL,
	BUG_LABEL,
	ENHANCEMENT_LABEL,
	has_label_name,
} from '#scripts/issue/issue-labels'

// The text of a `filed` event: the Issue a run filed, its kind, its title, and the child whose work
// turned it up. `issue:file` writes it and `run:board` reads it back, both through this module, so the
// two never spell it differently.

// The classification labels a filing's kind is read from, in precedence order: a breaking change is
// named as one whatever else it is.
const KINDS = [BREAKING_CHANGE_LABEL, BUG_LABEL, ENHANCEMENT_LABEL] as const

type FiledKind = (typeof KINDS)[number]

interface Filed {
	// `#<N>` for this repository's Issue, `<owner>/<repo>#<N>` for one filed elsewhere.
	reference: string
	// The filing's classification label; none where it carries none of `KINDS`, and on an event written
	// before the kind was recorded.
	kind: FiledKind | undefined
	title: string
	// The lane child that was working when the Issue was filed, when the filing came from one.
	found_during: string | undefined
}

// The kind slot is always written, `[<label>]` or `[]`, against the reference with no space: an event
// written before the kind always has the space there, so no title, whatever it opens with, reads as a
// kind.
const TEXT_PATTERN = new RegExp(
	String.raw`^(?<reference>\S*#\d+)(?:\[(?<kind>${KINDS.join('|')}|)\])? (?<title>.*?)(?: \(found during #(?<during>\d+)\))?$`,
	'u',
)

// Through the case-insensitive comparison GitHub applies, so a `--label Bug` filing is still a bug.
function kind_of(labels: ReadonlyArray<string>): FiledKind | undefined {
	return KINDS.find((kind) => has_label_name(labels, kind))
}

function text_of(filed: Filed): string {
	const kind = `[${filed.kind ?? ''}]`
	const suffix =
		filed.found_during === undefined
			? ''
			: ` (found during ${issue_cite.plain(filed.found_during)})`

	return `${filed.reference}${kind} ${filed.title}${suffix}`
}

function parse(text: string): Filed | undefined {
	const groups = TEXT_PATTERN.exec(text)?.groups

	if (groups === undefined) return undefined

	return {
		reference: String(groups['reference']),
		kind: KINDS.find((kind) => kind === groups['kind']),
		title: String(groups['title']),
		found_during: groups['during'],
	}
}

const run_event_filed = { kind_of, parse, text_of }

export { run_event_filed }
export type { Filed, FiledKind }

// The text of a `filed` event (joshuafolkken/kit#3430): the Issue a run filed, its title, and the child
// whose work turned it up. `issue:file` writes it and `run:board` reads it back, both through this module,
// so the two never spell it differently.

interface Filed {
	// `#<N>` for this repository's Issue, `<owner>/<repo>#<N>` for one filed elsewhere.
	reference: string
	title: string
	// The lane child that was working when the Issue was filed, when the filing came from one.
	found_during: string | undefined
}

const TEXT_PATTERN = /^(?<reference>\S*#\d+) (?<title>.*?)(?: \(found during #(?<during>\d+)\))?$/u

function text_of(filed: Filed): string {
	const suffix = filed.found_during === undefined ? '' : ` (found during #${filed.found_during})`

	return `${filed.reference} ${filed.title}${suffix}`
}

function parse(text: string): Filed | undefined {
	const groups = TEXT_PATTERN.exec(text)?.groups

	if (groups === undefined) return undefined

	return {
		reference: String(groups['reference']),
		title: String(groups['title']),
		found_during: groups['during'],
	}
}

const run_event_filed = { parse, text_of }

export { run_event_filed }
export type { Filed }

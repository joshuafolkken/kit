import { document_scan } from '#scripts/document/document-scan'

// The label names a script's source spells, pulled out so `issue-label-scan.test.ts` can hold every
// module to `issue-labels.ts`: a label applied, removed or created under a name `ALL_LABELS` lacks is
// one `josh start` never provisioned, and it fails silently on the repository that lacks it.
// Pure string extractors, so the scan can be checked on a synthetic source with a broken name in it.

// A `*_LABEL` constant holding a name inline — in `issue-labels.ts` the definitions, anywhere else a copy.
const LABEL_CONSTANT = /^const \w+_LABEL(?:: \w+)? = '([^']+)'$/gmu
// A label helper whose last argument is the name, spelled inline — on one line or wrapped one argument
// per line with a trailing comma, as the formatter writes a long call. The argument run admits one level
// of parentheses (`body()`) and no unmatched one, so the match cannot leave the call.
const LABEL_CALL =
	/\b(?:issue_add_label|issue_remove_label|issue_apply_label|add_pr_classification|pr_create)\((?:[^()]|\([^()]*\))*?'([^']+)',?\s*\)/gu
// A `labels: [...]` payload, as `issue_create_request` and the setup pull request send it.
const LABELS_ARRAY = /\blabels: \[([^\]]*)\]/gu
const QUOTED = /'([^']+)'/gu
const COMMENT_PREFIX = '//'

function captures(text: string, pattern: RegExp): Array<string> {
	return [...text.matchAll(pattern)].map((match) => match[1] ?? '')
}

// A comment cites label commands as prose (`-f x=repos/…/labels/a`); only code applies one.
function code_lines(source: string): string {
	return source
		.split('\n')
		.filter((line) => !line.trimStart().startsWith(COMMENT_PREFIX))
		.join('\n')
}

function label_constant_values(source: string): Array<string> {
	return captures(source, LABEL_CONSTANT)
}

function applied_label_names(source: string): Array<string> {
	const code = code_lines(source)
	const arrays = captures(code, LABELS_ARRAY).flatMap((items) => captures(items, QUOTED))

	return [...document_scan.label_references(code), ...captures(code, LABEL_CALL), ...arrays]
}

const issue_label_scan = {
	applied_label_names,
	label_constant_values,
}

export { issue_label_scan }

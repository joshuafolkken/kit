import { document_scan } from '#scripts/document/document-scan'

// The label names a script's source spells, pulled out so `issue-label-scan.test.ts` can hold every
// module to `issue-labels.ts`: a label applied, removed or created under a name `ALL_LABELS` lacks is
// one `josh start` never provisioned, and it fails silently on the repository that lacks it.
// Pure string extractors, so the scan can be checked on a synthetic source with a broken name in it.

// A `*_LABEL` constant holding a name inline — in `issue-labels.ts` the definitions, anywhere else a copy.
const LABEL_CONSTANT = /^const \w+_LABEL(?:: \w+)? = '([^']+)'$/gmu
// Any constant holding a string inline, so a label argument naming one resolves to the name it holds.
const LOCAL_CONSTANT = /^const (\w+)(?:: \w+)? = '([^']+)'$/gmu
// The argument list of a label helper whose last argument is the name — on one line or wrapped one
// argument per line with a trailing comma, as the formatter writes a long call. The list admits one level
// of parentheses (`body()`) and no unmatched one, so the match cannot leave the call.
const LABEL_CALL =
	/\b(?:issue_add_label|issue_remove_label|issue_apply_label|add_pr_classification|pr_create)\(((?:[^()]|\([^()]*\))*)\)/gu
// A `labels: [...]` payload, as `issue_create_request` and the setup pull request send it.
const LABELS_ARRAY = /\blabels: \[([^\]]*)\]/gu
const ARGUMENT_SEPARATOR = ','
const QUOTE = "'"
const COMMENT_PREFIX = '//'

function captures(text: string, pattern: RegExp): Array<string> {
	return [...text.matchAll(pattern)].map((match) => match[1] ?? '')
}

function local_constants(code: string): Map<string, string> {
	return new Map(
		[...code.matchAll(LOCAL_CONSTANT)].map(([, name = '', value = '']): [string, string] => [
			name,
			value,
		]),
	)
}

function list_items(list: string): Array<string> {
	return list
		.split(ARGUMENT_SEPARATOR)
		.map((item) => item.trim())
		.filter((item) => item !== '')
}

function last_argument(list: string): Array<string> {
	return list_items(list).slice(-1)
}

// An inline name is taken as is; a constant this module defines resolves to its value. An imported
// constant does not resolve — the module that defines it is scanned on its own.
function resolved(token: string, constants: ReadonlyMap<string, string>): string | undefined {
	if (token.startsWith(QUOTE)) return token.slice(1, -1)

	return constants.get(token)
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
	const constants = local_constants(code)
	const tokens = [
		...captures(code, LABEL_CALL).flatMap((list) => last_argument(list)),
		...captures(code, LABELS_ARRAY).flatMap((list) => list_items(list)),
	]
	const names = tokens
		.map((token) => resolved(token, constants))
		.filter((name) => name !== undefined)

	return [...document_scan.label_references(code), ...names]
}

const issue_label_scan = {
	applied_label_names,
	label_constant_values,
}

export { issue_label_scan }

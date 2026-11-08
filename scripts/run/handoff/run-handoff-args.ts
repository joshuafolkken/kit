// `josh run:handoff`'s arguments: the workflow keyword, the entry typed after it, and the brief the
// consultation session wrote. `backlogrun` is told apart here because it is handed to `josh backlogrun`
// whole — its arguments are that command's, and it takes no brief.
//
// **A bare number is an issue.** A shell reads an unquoted `#12` as a comment, so `12` in the entry is
// handed to the child as `#12`, as `josh backlogrun` reads it (`backlogrun-args.ts`).

import { issue_number_shape } from '#scripts/issue/issue-number-shape'

const BRIEF_FLAG = '--brief-file'
const BACKLOG_KEYWORD = 'backlogrun'
const NOT_FOUND = -1
const FLAG_AND_VALUE = 2

// `retrospective` is started by a backlogrun at its end, never typed, so it takes no entry and no brief
// file — its brief is generated (`run-handoff-retrospective.ts`).
const RETROSPECTIVE_KEYWORD = 'retrospective'
const TYPED_KEYWORDS = ['kickoff', 'fullrun', 'halfrun', 'prrun'] as const
const WORKFLOW_KEYWORDS = [...TYPED_KEYWORDS, RETROSPECTIVE_KEYWORD] as const

// Every keyword a person types to `run:handoff` — the one list the `session-lang` prompt hook matches too.
const KEYWORDS: ReadonlyArray<string> = [...TYPED_KEYWORDS, BACKLOG_KEYWORD]

type WorkflowKeyword = (typeof WORKFLOW_KEYWORDS)[number]

// Widened so `.includes()` takes any token; the guard below narrows it back.
const WORKFLOW_KEYWORD_TOKENS: ReadonlyArray<string | undefined> = WORKFLOW_KEYWORDS

interface WorkflowHandoff {
	kind: 'workflow'
	keyword: WorkflowKeyword
	// The keyword line the child is started with, as the person typed it.
	line: string
	// `undefined` for `retrospective`, whose brief is generated rather than read.
	brief_file: string | undefined
}

type HandoffArguments =
	| WorkflowHandoff
	| { kind: 'backlogrun'; rest: ReadonlyArray<string> }
	| { kind: 'refused'; note: string }

function is_workflow_keyword(token: string | undefined): token is WorkflowKeyword {
	return WORKFLOW_KEYWORD_TOKENS.includes(token)
}

function refused(note: string): HandoffArguments {
	return { kind: 'refused', note }
}

function workflow_of(keyword: WorkflowKeyword, rest: ReadonlyArray<string>): HandoffArguments {
	const at = rest.indexOf(BRIEF_FLAG)
	const brief_file = at === NOT_FOUND ? undefined : rest[at + 1]

	if (brief_file === undefined || brief_file.startsWith('-')) {
		return refused(`${keyword} needs ${BRIEF_FLAG} <path>`)
	}

	const entry = [...rest.slice(0, at), ...rest.slice(at + FLAG_AND_VALUE)]

	if (entry.includes(BRIEF_FLAG)) return refused(`${BRIEF_FLAG} is given more than once`)

	const line = [keyword, ...entry.map((token) => issue_number_shape.issue_token(token))].join(' ')

	return { kind: 'workflow', keyword, line, brief_file }
}

function retrospective_of(rest: ReadonlyArray<string>): HandoffArguments {
	if (rest.length > 0) return refused(`${RETROSPECTIVE_KEYWORD} takes no other argument`)

	const keyword = RETROSPECTIVE_KEYWORD

	return { kind: 'workflow', keyword, line: keyword, brief_file: undefined }
}

function parse(argv: ReadonlyArray<string>): HandoffArguments {
	const [keyword, ...rest] = argv

	if (keyword === BACKLOG_KEYWORD) return { kind: 'backlogrun', rest }

	if (keyword === RETROSPECTIVE_KEYWORD) return retrospective_of(rest)

	if (!is_workflow_keyword(keyword)) {
		return refused(`expected one of ${WORKFLOW_KEYWORDS.join(', ')}, ${BACKLOG_KEYWORD}`)
	}

	return workflow_of(keyword, rest)
}

const run_handoff_args = { BACKLOG_KEYWORD, KEYWORDS, RETROSPECTIVE_KEYWORD, parse }

export type { HandoffArguments, WorkflowHandoff, WorkflowKeyword }
export { run_handoff_args }

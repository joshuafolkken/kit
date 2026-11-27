import { run_headless_keys } from '#scripts/run/run-headless-keys'
import { HANDOFF_IMPLEMENTING_LABEL, has_label_name } from './issue-labels'

// The one reader of the hand-off marks `josh issue:file` acts on (joshuafolkken/kit#9143). A
// `run:handoff fullrun new` / `halfrun new` / `prrun new` child implements the Issue it files, so the
// filing carries `handoff:implementing`, which `issue-auto-ok.ts` excludes: `backlogrun` never offers
// it beside the run that holds it, and a later `auto-ok:judge` reads the same label. Only the marks
// `run:handoff` writes decide it — never the body or the session — so `kickoff new`, a direct filing
// and an observation filed by any other run are judged as before. A `fullrun new` a person types into
// a session directly leaves no mark in the environment, so it is out of reach here.

const IMPLEMENTING_KEYWORDS: ReadonlySet<string> = new Set(['fullrun', 'halfrun', 'prrun'])
const NEW_ENTRY = 'new'
const WORD_SEPARATOR = /\s+/u
const MARKED = '1'

function is_implementing_new(line = ''): boolean {
	const [keyword = '', entry] = line.trim().split(WORD_SEPARATOR)

	return IMPLEMENTING_KEYWORDS.has(keyword) && entry === NEW_ENTRY
}

// Whether the environment is a handed-off implementing run's own filing.
function is_handed_off(environment: NodeJS.ProcessEnv): boolean {
	if (environment[run_headless_keys.HANDOFF_CHILD_KEY] !== MARKED) return false

	return is_implementing_new(environment[run_headless_keys.HANDOFF_LINE_KEY])
}

// The filing's `--label` list, with `handoff:implementing` added when the environment is marked.
function with_label(
	labels: ReadonlyArray<string>,
	environment: NodeJS.ProcessEnv,
): ReadonlyArray<string> {
	const is_owed = is_handed_off(environment) && !has_label_name(labels, HANDOFF_IMPLEMENTING_LABEL)

	return is_owed ? [...labels, HANDOFF_IMPLEMENTING_LABEL] : labels
}

const issue_handoff_filing = { is_handed_off, with_label }

export { issue_handoff_filing }

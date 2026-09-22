import type { GuardedCall } from './time-batch-guard'

// The calls, labels and transcript builder the batch-guard suite is written from, lifted out of
// `time-batch-guard.test.ts` so the suite stays under its line limit as kit#2311 adds the read-fold
// cases (joshuafolkken/kit#2311). Fixtures rather than tests, so they carry no `describe`; the one
// test file that reads them imports the names it already used.

const NEVER_REFUSED = 0
const FRESH_PATH = 'scripts/fresh.ts'
// A path-shaped word that appears only inside quotes (joshuafolkken/kit#1611).
const QUOTED_PATTERN = 'scripts/time'
const FRESH_CALL: GuardedCall = { name: 'Read', input: { file_path: FRESH_PATH } }
// The two calls both predicate tables name, and their labels, so neither the fixture nor the wording is
// written twice.
const EDIT_LABEL = 'an edit'
const SED_LABEL = 'an in-place sed'
const FILE_READ_LABEL = 'a file read'
const EDIT_TOOL = 'Edit'
// Named the way this harness names it. Neither spelling of the delegation tool is in the bundleable
// set, so the case reads the same under `Task`.
const DELEGATION_TOOL = 'Agent'
const WRITE_TOOL = 'Write'
const WRITE_LABEL = 'a whole-file write'
const EDIT_CALL: GuardedCall = { name: EDIT_TOOL, input: { file_path: FRESH_PATH } }
const IN_PLACE_SED_CALL: GuardedCall = {
	name: 'Bash',
	input: { command: `sed -i '' s/a/b/ ${FRESH_PATH}` },
}
const SHELL_READ_CALL: GuardedCall = { name: 'Bash', input: { command: `cat ${FRESH_PATH}` } }
const JOSH_CALL: GuardedCall = { name: 'Bash', input: { command: 'pnpm josh gate' } }
const CHAINED_SED_CALL: GuardedCall = {
	name: 'Bash',
	input: { command: `cat notes.md && sed -i '' s/a/b/ ${FRESH_PATH}` },
}
const REDIRECTION_CALL: GuardedCall = {
	name: 'Bash',
	input: { command: "jq '.x' a.json > b.json" },
}
const WRITE_CALL: GuardedCall = { name: WRITE_TOOL, input: { file_path: FRESH_PATH } }

// The turns of one run, joined the way Claude Code writes them: one line per content block.
function transcript(...groups: Array<Array<string>>): string {
	return groups.flat().join('\n')
}

export {
	CHAINED_SED_CALL,
	DELEGATION_TOOL,
	EDIT_CALL,
	EDIT_LABEL,
	EDIT_TOOL,
	FILE_READ_LABEL,
	FRESH_CALL,
	FRESH_PATH,
	IN_PLACE_SED_CALL,
	JOSH_CALL,
	NEVER_REFUSED,
	QUOTED_PATTERN,
	REDIRECTION_CALL,
	SED_LABEL,
	SHELL_READ_CALL,
	WRITE_CALL,
	WRITE_LABEL,
	WRITE_TOOL,
	transcript,
}

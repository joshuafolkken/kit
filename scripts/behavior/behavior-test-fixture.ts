import type { Block } from '#scripts/time-runtime/time-transcript-line'

// Shared builders for the behavior suites, so the JSONL transcript shape and the parsed-block shape
// are stated once rather than copied into every test (joshuafolkken/kit#2365).

const TIMESTAMP = '2026-09-22T00:00:00.000Z'
const BRANCH = '2365-lane'
const BASH = 'Bash'
const TOOL_USE = 'tool_use'
const TOOL_RESULT = 'tool_result'
const TOOL_ID = 'tool-1'
const DENIED_BASH = 'Permission to use Bash with command git commit has been denied.'

// Command strings the suites reuse — a read-only one, a mutation, a dry run and the josh wrapper —
// named once so the duplicate-literal rule is satisfied and the intent reads off the name.
const GIT_STATUS = 'git status'
const GIT_COMMIT = 'git commit -m "x"'
const GIT_ADD_DRY = 'git add -n .'
const JOSH_GIT = 'pnpm josh git -y'

// One assistant line running a single Bash command, in the JSONL shape `parse_line` reads.
function bash_line(command: string, id = TOOL_ID): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: TIMESTAMP,
		gitBranch: BRANCH,
		message: { id: 'msg', content: [{ type: TOOL_USE, name: BASH, id, input: { command } }] },
	})
}

function bash_result_line(id: string, is_error: boolean, content: string): string {
	return JSON.stringify({
		type: 'user',
		timestamp: TIMESTAMP,
		gitBranch: BRANCH,
		message: { content: [{ type: TOOL_RESULT, tool_use_id: id, is_error, content }] },
	})
}

// A parsed Bash tool-use block, for the rule tests that call `command_of` directly rather than
// through a whole transcript.
function bash_block(command: string): Block {
	return {
		type: TOOL_USE,
		name: BASH,
		id: '',
		result_id: '',
		input: { command },
		is_error: undefined,
		has_failure_line: false,
		followup_stages: [],
		error_text: '',
		refusal_guard: '',
		background_id: '',
	}
}

const behavior_test_fixture = {
	BASH,
	DENIED_BASH,
	GIT_ADD_DRY,
	GIT_COMMIT,
	GIT_STATUS,
	JOSH_GIT,
	TOOL_USE,
	TOOL_ID,
	bash_block,
	bash_line,
	bash_result_line,
}

export { behavior_test_fixture }

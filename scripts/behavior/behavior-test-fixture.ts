import type { Block } from '#scripts/time-runtime/time-transcript-line'

// Shared builders for the behavior suites, so the JSONL transcript shape and the parsed-block shape
// are stated once rather than copied into every test (joshuafolkken/kit#2365).

const TIMESTAMP = '2026-09-22T00:00:00.000Z'
const BRANCH = '2365-lane'
const BASH = 'Bash'
const TOOL_USE = 'tool_use'

// Command strings the suites reuse — a read-only one, a mutation, a dry run and the josh wrapper —
// named once so the duplicate-literal rule is satisfied and the intent reads off the name.
const GIT_STATUS = 'git status'
const GIT_COMMIT = 'git commit -m "x"'
const GIT_ADD_DRY = 'git add -n .'
const JOSH_GIT = 'pnpm josh git -y'

// One assistant line running a single Bash command, in the JSONL shape `parse_line` reads.
function bash_line(command: string): string {
	return JSON.stringify({
		type: 'assistant',
		timestamp: TIMESTAMP,
		gitBranch: BRANCH,
		message: { id: 'msg', content: [{ type: TOOL_USE, name: BASH, input: { command } }] },
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
	GIT_ADD_DRY,
	GIT_COMMIT,
	GIT_STATUS,
	JOSH_GIT,
	TOOL_USE,
	bash_block,
	bash_line,
}

export { behavior_test_fixture }

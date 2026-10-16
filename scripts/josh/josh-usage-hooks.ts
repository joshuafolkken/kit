import type { CommandUsage } from './josh-command-types'

// The usage of the Claude Code and Codex hook commands `docs/josh-commands-automation.md` documents
// under "Development", keyed by command name. A hook is fed its payload as JSON on stdin, so each
// example names the event that runs it rather than an argument. The page's usage blocks are generated
// from this table and `josh help <command>` prints it, so an example is written once, here (#3981).
const PRE_TOOL_USE = 'run by the PreToolUse hook, the pending tool call as JSON on stdin'
const IN_PRETOOL_GUARD = 'run inside pretool:guard, not wired on its own'

/* eslint-disable @typescript-eslint/naming-convention */
const HOOK_USAGE: Readonly<Record<string, CommandUsage>> = {
	'format:edited': {
		examples: [
			{ arguments: '', note: 'run by the PostToolUse hook, the tool call as JSON on stdin' },
		],
	},
	'batch:guard': { examples: [{ arguments: '', note: IN_PRETOOL_GUARD }] },
	'investigation:guard': { examples: [{ arguments: '', note: PRE_TOOL_USE }] },
	'duplicate-read:guard': { examples: [{ arguments: '', note: IN_PRETOOL_GUARD }] },
	'rule:guard': { examples: [{ arguments: '', note: PRE_TOOL_USE }] },
	'rule:list': { examples: [{ arguments: '', note: 'print every trigger-delivered rule' }] },
	'pretool:guard': { examples: [{ arguments: '', note: PRE_TOOL_USE }] },
	'codex:hook-adapter': {
		examples: [
			{ arguments: 'pretool', note: 'a Codex PreToolUse payload on stdin' },
			{ arguments: 'posttool', note: 'a Codex PostToolUse payload on stdin' },
		],
	},
	'stop:guard': {
		examples: [{ arguments: '', note: 'run by the Stop hook, the stop payload as JSON on stdin' }],
	},
	'session:lang': {
		examples: [{ arguments: '', note: 'run by the UserPromptSubmit hook; `ja` prints nothing' }],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { HOOK_USAGE }

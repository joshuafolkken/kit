import type { CommandEntry } from './josh-command-types'

const PRE_TOOL_USE = 'run by the PreToolUse hook, the pending tool call as JSON on stdin'
const IN_PRETOOL_GUARD = 'run inside pretool:guard, not wired on its own'

// The `PreToolUse` guard registry, split out of `josh-commands-ai.ts` so that file stays under its
// 300-code-line limit, exactly as `LANE_COMMANDS` and `SPLIT_COMMANDS` were for the same reason.
// It is spread into
// `AI_COMMANDS` so the guards stay grouped with the other AI tools.
//
// **None declare `tsx_arguments`, for the reason `batch:guard` declares none**:
// declaring any disqualifies a command from in-process dispatch, and these run in front of every read
// or shell call. Each script calls `process.loadEnvFile` itself instead, through `hook-decision.ts`.

/* eslint-disable @typescript-eslint/naming-convention */
const GUARD_COMMANDS: Record<string, CommandEntry> = {
	'investigation:guard': {
		script: 'scripts/delegation/investigation-guard-main.ts',
		description:
			'Claude Code hook: refuse a read once the unedited-read threshold is reached again (reads the tool call on stdin)',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
		usage: { examples: [{ arguments: '', note: PRE_TOOL_USE }] },
	},
	'duplicate-read:guard': {
		script: 'scripts/delegation/duplicate-read-guard-main.ts',
		description:
			'Claude Code hook: refuse a second whole-file read of a path whose content has not changed since the run last read it (reads the tool call on stdin)',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
		usage: { examples: [{ arguments: '', note: IN_PRETOOL_GUARD }] },
	},
	'rule:guard': {
		script: 'scripts/rules/rule-guard.ts',
		description:
			'Claude Code hook: deliver a trigger-delivered rule at the call that binds it (reads the tool call on stdin)',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
		usage: { examples: [{ arguments: '', note: PRE_TOOL_USE }] },
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { GUARD_COMMANDS }

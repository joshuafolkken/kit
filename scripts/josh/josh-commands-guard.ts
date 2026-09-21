import type { CommandEntry } from './josh-command-types'

// The `PreToolUse` guard registry, split out of `josh-commands-ai.ts` so that file stays under its
// 300-code-line limit, exactly as `LANE_COMMANDS` and `SPLIT_COMMANDS` were for the same reason
// (joshuafolkken/kit#2162, joshuafolkken/kit#2218, joshuafolkken/kit#2298). It is spread into
// `AI_COMMANDS` so the guards stay grouped with the other AI tools.
//
// **None declare `tsx_arguments`, for the reason `batch:guard` declares none** (joshuafolkken/kit#1342):
// declaring any disqualifies a command from in-process dispatch, and these run in front of every read
// or shell call. Each script calls `process.loadEnvFile` itself instead, through `hook-decision.ts`.

/* eslint-disable @typescript-eslint/naming-convention */
const GUARD_COMMANDS: Record<string, CommandEntry> = {
	'investigation:guard': {
		script: 'scripts/delegation/investigation-guard.ts',
		description:
			'Claude Code hook: refuse a read once the unedited-read threshold is reached again (reads the tool call on stdin)',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
	},
	'duplicate-read:guard': {
		script: 'scripts/delegation/duplicate-read-guard.ts',
		description:
			'Claude Code hook: refuse a second whole-file read of a path whose content has not changed since the run last read it (reads the tool call on stdin)',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
	},
	'rule:guard': {
		script: 'scripts/rules/rule-guard.ts',
		description:
			'Claude Code hook: deliver a trigger-delivered rule at the call that binds it (reads the tool call on stdin)',
		category: 'AI tools',
		reference: ['', 'automation', ['none']],
	},
}
/* eslint-enable @typescript-eslint/naming-convention */

export { GUARD_COMMANDS }

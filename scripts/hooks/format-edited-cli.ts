#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { bash_revert } from './bash-revert'
import { report_no_payload, run_hook } from './format-edited-file'

// The `PostToolUse` hook's entry, kept apart from `format-edited-file.ts` for the reason
// `pretool-guard-cli.ts` gives: `codex-hook-adapter.ts` imports that module,
// so a self-invoke left in it lands in a shared chunk and the bundled hook never runs.
// A `Bash` call goes to the consultation-scope revert instead (`bash-revert.ts`).
async function respond(payload: string): Promise<void> {
	if (bash_revert.is_shell(payload)) bash_revert.respond(payload)
	else await run_hook(payload)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) {
		report_no_payload()
	} else {
		await respond(await text(process.stdin))
	}
}

#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { report_no_payload, run_hook } from './format-edited-file'

// The `PostToolUse` hook's entry, kept apart from `format-edited-file.ts` for the reason
// `pretool-guard-cli.ts` gives: `codex-hook-adapter.ts` imports that module,
// so a self-invoke left in it lands in a shared chunk and the bundled hook never runs.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) {
		report_no_payload()
	} else {
		await run_hook(await text(process.stdin))
	}
}

#!/usr/bin/env tsx
import { text } from 'node:stream/consumers'
import { fileURLToPath } from 'node:url'
import { hook_decision } from '#scripts/josh/hook-decision'
import { pretool_guard } from './pretool-guard'

// The `PreToolUse` hook's entry, kept apart from the composition in `pretool-guard.ts`.
// The hook bundles are built with `splitting: true`, which moves a module
// imported by two entries into a shared chunk — and `codex-hook-adapter.ts` imports `pretool-guard.ts`.
// Its self-invoke went into that chunk, whose `import.meta.url` never equals the launched
// `dist/hooks/pretool-guard.js`, so the bundled hook ran no guard at all and every refusal failed open.
// An entry nothing imports keeps the self-invoke in the file that is actually launched.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
	if (process.stdin.isTTY) hook_decision.report_no_payload('pretool:guard')
	else {
		const raw_payload = await text(process.stdin)

		hook_decision.load_environment_file()
		await pretool_guard.respond(raw_payload)
	}
}

#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_evidence_exit } from '#scripts/issue/issue-evidence-exit'
import { issue_measured_close } from '#scripts/issue/issue-measured-close'

// `josh issue:measured <N> --evidence-file <path>` — the completion of a measurement-only Issue
// (`issue-comments.md` → "A measurement-only Issue"): the result comment, the
// `measured` label, the close and the `run:release`, in that order (`issue-evidence-exit.ts`,
// `issue-measured-close.ts`).

const ARGV_OFFSET = 2

async function run(argv: ReadonlyArray<string>): Promise<number> {
	return await issue_evidence_exit.run(argv, issue_measured_close.MEASURED_EXIT)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_measured_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_measured_cli }

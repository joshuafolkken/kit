#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { issue_evidence_exit } from '#scripts/issue/issue-evidence-exit'
import { issue_measured_close } from '#scripts/issue/issue-measured-close'

// `josh issue:measured <N> --evidence-file <path>` — the completion of a measurement-only Issue
// (`issue-comments.md` → "A measurement-only Issue"): the result comment, the
// `measured` label, the close and the `run:release`, in that order (`issue-evidence-exit.ts`,
// `issue-measured-close.ts`). `--unmet` records that the measurement fell short of the expected
// effect, with the `measured:unmet` label `josh effect:audit` reads.

const ARGV_OFFSET = 2
const UNMET_FLAG = '--unmet'

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const exit = argv.includes(UNMET_FLAG)
		? issue_measured_close.MEASURED_UNMET_EXIT
		: issue_measured_close.MEASURED_EXIT

	return await issue_evidence_exit.run(
		argv.filter((argument) => argument !== UNMET_FLAG),
		exit,
	)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_measured_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_measured_cli }

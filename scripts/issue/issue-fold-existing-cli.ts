#!/usr/bin/env tsx
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'
import { issue_fold_existing } from './issue-fold-existing'

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const SUCCESS_EXIT_CODE = 0
const USAGE = 'Usage: josh issue:fold-existing <assessment.json> [--json]'

const assessment_schema = z.object({
	content: z.enum(['duplicate', 'compatible', 'separate', 'unknown']),
	is_open: z.boolean().optional(),
	is_unstarted: z.boolean().optional(),
	has_pull_request: z.boolean().optional(),
	has_complete_read: z.boolean(),
	has_dependency_conflict: z.boolean().optional(),
	is_separable: z.boolean().optional(),
	size_verdict: z.enum(['split', 'single']).optional(),
	existing_body: z.string(),
	draft_body: z.string().trim().min(1),
	verification: z.string().trim().min(1),
})

function print_assessment(input: z.infer<typeof assessment_schema>, should_json: boolean): void {
	const verdict = issue_fold_existing.decide(input)
	const body =
		verdict === 'fold'
			? issue_fold_existing.append_requirements(
					input.existing_body,
					input.draft_body,
					input.verification,
				)
			: undefined

	if (should_json) {
		console.info(JSON.stringify({ verdict, body }))

		return
	}

	console.info(`Fold: ${verdict}`)
	if (body !== undefined) console.info(body)
}

async function assess(path: string, should_json: boolean): Promise<number> {
	try {
		const input = assessment_schema.parse(JSON.parse(await readFile(path, 'utf8')))

		print_assessment(input, should_json)

		return SUCCESS_EXIT_CODE
	} catch {
		console.error('Could not read a complete assessment; no fold recommendation was made.')

		return FAILURE_EXIT_CODE
	}
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const [path, option, extra] = argv

	if (path !== undefined && extra === undefined && (option === undefined || option === '--json')) {
		return await assess(path, option === '--json')
	}

	console.error(USAGE)

	return FAILURE_EXIT_CODE
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	process.exitCode = await run(argv)
}

const issue_fold_existing_cli = { run, main, USAGE }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { issue_fold_existing_cli }

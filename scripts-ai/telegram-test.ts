#!/usr/bin/env node
import { execFile } from 'node:child_process'
import { parseArgs, promisify } from 'node:util'
import { telegram_notify } from '../scripts/git/telegram-notify'
import { telegram_test_logic, type CliValues, type ResolvedContext } from './telegram-test-logic'

const exec_file_async = promisify(execFile)

const REPO_NAME_SEPARATOR = '/'

function parse_cli_arguments(): CliValues {
	const { values } = parseArgs({
		options: {
			'task-type': { type: 'string' },
			'repo-name': { type: 'string' },
			'issue-title': { type: 'string' },
			body: { type: 'string' },
			'issue-url': { type: 'string' },
			'pr-url': { type: 'string' },
		},
	})

	return values
}

async function exec_gh(arguments_: ReadonlyArray<string>): Promise<string | undefined> {
	try {
		const { stdout } = await exec_file_async('gh', [...arguments_])

		return stdout.trim()
	} catch {
		return undefined
	}
}

async function fetch_repo_name(): Promise<string | undefined> {
	const name_with_owner = await exec_gh([
		'repo',
		'view',
		'--json',
		'nameWithOwner',
		'-q',
		'.nameWithOwner',
	])

	if (name_with_owner === undefined) return undefined

	const parts = name_with_owner.split(REPO_NAME_SEPARATOR)

	return parts.at(-1)
}

async function fetch_issue_title(issue_number: string | undefined): Promise<string | undefined> {
	if (issue_number === undefined) return undefined

	return await exec_gh(['issue', 'view', issue_number, '--json', 'title', '-q', '.title'])
}

async function resolve_context(values: CliValues): Promise<ResolvedContext> {
	const repo_name = await fetch_repo_name()
	const issue_number = telegram_test_logic.parse_issue_number(values['issue-url'])
	const issue_title = await fetch_issue_title(issue_number)

	return { repo_name, issue_title }
}

async function main(): Promise<void> {
	const values = parse_cli_arguments()
	const context = await resolve_context(values)
	const input = telegram_test_logic.build_input({ values, context })

	await telegram_notify.send(input)
}

await main()

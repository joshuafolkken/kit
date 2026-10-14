#!/usr/bin/env tsx
import { mkdirSync, readdirSync, readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import { gh_cli_token } from '#scripts/gh/gh-cli-token'
import { git_gh_exec } from '#scripts/gh/git-gh-exec'
import { PROJECT_ROOT } from '#scripts/init/init-paths'
import { self_sync_guard } from '#scripts/self-sync-guard/self-sync-guard-logic'
import { KIT_PACKAGE_NAME } from '#scripts/version/kit-descriptor'
import { fresh_machine_docker } from './fresh-machine-docker'
import { fresh_machine_log } from './fresh-machine-log'
import { fresh_machine_patterns } from './fresh-machine-patterns'
import { fresh_machine_run, type RunRequest } from './fresh-machine-run'
import { fresh_machine_spec, type Scenario } from './fresh-machine-spec'

// `josh fresh:run <pattern>` / `josh fresh:run --spec <file>` — run one scenario on a machine that
// has nothing installed, and keep what happened as a log.

const ARGV_OFFSET = 2
const FAILURE_EXIT_CODE = 1
const USAGE =
	'Usage: josh fresh:run <pattern> | --spec <file.json> [--package-version <version>] [--log-dir <dir>] [--rebuild] | --list'
// The scratch directory kit's distributed `.gitignore` already ignores, so a log is never committed
// from kit or from a consumer toolkit.
const DEFAULT_LOG_DIRECTORY = '.claude/tmp/fresh-machine'
const NO_TOKEN =
	'This scenario uses GitHub and `gh auth token` printed no token. Run `gh auth login` on this machine first.'
const NO_SECRET =
	'This scenario passes secrets into the container by name, and this environment does not set them. Export them first: '
// The patterns install kit by name, while the tarball and the published version are those of the
// checkout the command is run from — in a toolkit's checkout the two would be different packages.
const NOT_A_KIT_CHECKOUT = `The named patterns install ${KIT_PACKAGE_NAME} and run from its checkout only. Write this package's scenario as a JSON file and pass it with --spec.`
const OWNED_REPOSITORIES = 'user/repos?affiliation=owner&per_page=100'
const REPOSITORY_NAMES = '.[].name'

// The option names are the CLI's, so the type is read off the parser rather than restated.
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function parse(argv: ReadonlyArray<string>) {
	return parseArgs({
		args: [...argv],
		allowPositionals: true,
		options: {
			spec: { type: 'string' },
			'package-version': { type: 'string' },
			'log-dir': { type: 'string' },
			rebuild: { type: 'boolean' },
			list: { type: 'boolean' },
		},
	})
}

type CliValues = ReturnType<typeof parse>['values']

function pattern_of(name: string): Scenario | undefined {
	const scenario = fresh_machine_patterns.find(name)

	if (scenario === undefined) return undefined

	const is_kit_checkout = self_sync_guard.read_package_name(PROJECT_ROOT) === KIT_PACKAGE_NAME

	if (!is_kit_checkout) throw new Error(NOT_A_KIT_CHECKOUT)

	return scenario
}

function scenario_of(values: CliValues, pattern: string | undefined): Scenario | undefined {
	if (values.spec !== undefined) {
		return fresh_machine_spec.parse(readFileSync(path.resolve(PROJECT_ROOT, values.spec), 'utf8'))
	}

	return pattern === undefined ? undefined : pattern_of(pattern)
}

// A GitHub run's name is also the repository it creates under the account of the token, and the
// logs of this checkout are not the only place such a run was started from.
function repositories_of(scenario: Scenario): Array<string> {
	if (!scenario.requires_github) return []

	const names = git_gh_exec.exec_gh_api_sync({
		path: OWNED_REPOSITORIES,
		should_paginate: true,
		jq_filter: REPOSITORY_NAMES,
	})

	return names.split('\n').filter((name) => name !== '')
}

function request_of(
	scenario: Scenario,
	values: CliValues,
	secrets: Readonly<Record<string, string>>,
): RunRequest {
	const log_directory = path.resolve(PROJECT_ROOT, values['log-dir'] ?? DEFAULT_LOG_DIRECTORY)

	mkdirSync(log_directory, { recursive: true })

	const run_name = fresh_machine_log.next_name(scenario.name, {
		logs: readdirSync(log_directory),
		repositories: repositories_of(scenario),
	})

	return {
		scenario,
		run_name,
		log_path: path.join(log_directory, fresh_machine_log.file_name(run_name)),
		package_version: values['package-version'],
		secrets,
		is_rebuild: values.rebuild === true,
	}
}

function refuse(message: string): number {
	console.error(message)

	return FAILURE_EXIT_CODE
}

// `undefined` when the scenario uses GitHub and gh has no token to give it.
function github_secret(scenario: Scenario): Record<string, string> | undefined {
	if (!scenario.requires_github) return {}

	const token = gh_cli_token.get()

	return token === undefined ? undefined : { [fresh_machine_docker.TOKEN_VARIABLE]: token }
}

function missing_secrets(scenario: Scenario): Array<string> {
	return scenario.secrets.filter((name) => (process.env[name] ?? '') === '')
}

function spec_secrets(scenario: Scenario): Record<string, string> {
	return Object.fromEntries(scenario.secrets.map((name) => [name, process.env[name] ?? '']))
}

// Every secret is read before anything runs, so a missing one stops the run before Docker starts
// rather than after a container has created a repository.
async function run_scenario(scenario: Scenario, values: CliValues): Promise<number> {
	const github = github_secret(scenario)

	if (github === undefined) return refuse(NO_TOKEN)

	const missing = missing_secrets(scenario)

	if (missing.length > 0) return refuse(`${NO_SECRET}${missing.join(', ')}`)

	const request = request_of(scenario, values, { ...github, ...spec_secrets(scenario) })
	const exit_code = await fresh_machine_run.run(request)

	console.info(`Log: ${request.log_path}`)

	return exit_code
}

async function run(argv: ReadonlyArray<string>): Promise<number> {
	const { values, positionals } = parse(argv)
	const patterns = fresh_machine_patterns.names().join('\n')

	if (values.list === true) {
		console.info(patterns)

		return 0
	}

	const scenario = scenario_of(values, positionals[0])

	if (scenario === undefined) return refuse(`${USAGE}\n\nPatterns:\n${patterns}`)

	return await run_scenario(scenario, values)
}

async function main(argv: ReadonlyArray<string>): Promise<void> {
	try {
		process.exitCode = await run(argv)
	} catch (error) {
		process.exitCode = refuse(error instanceof Error ? error.message : String(error))
	}
}

const fresh_machine_cli = { run }

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(ARGV_OFFSET))

export { fresh_machine_cli }

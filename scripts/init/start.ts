#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { error_text } from '#scripts/lib/error-message'
import { init_dry_run } from './init-dry-run'
import { project_profile, type ProjectProfile, type ProjectShape } from './project-profile'
import { start_dry_run } from './start-dry-run'
import {
	start_plan,
	type Consent,
	type Interaction,
	type StartOptions,
	type StartStep,
} from './start-plan'
import { start_prompt, type Choices } from './start-prompt'
import { start_steps } from './start-steps'

const ARGUMENT_START_INDEX = 2
const READY_MESSAGE = 'GitHub workflow ready. Use kickoff new in your assistant to plan an Issue.'
const START_USAGE =
	'josh start [--profile basic|full] [--yes] [--github] [--public] [--dry-run] [--init-command <command>] [--push-preflight-command <command>]'
const INIT_COMMAND_FLAG = '--init-command'
const PUSH_PREFLIGHT_COMMAND_FLAG = '--push-preflight-command'
const YES_FLAG = '--yes'
const GITHUB_FLAG = '--github'
const PUBLIC_FLAG = '--public'
const { DRY_RUN_FLAG } = init_dry_run
const SWITCHES: ReadonlySet<string> = new Set([YES_FLAG, GITHUB_FLAG, PUBLIC_FLAG, DRY_RUN_FLAG])

interface Prepared {
	steps: ReadonlyArray<StartStep>
	interaction: Interaction
	choices: Choices
}

interface CommandSplit {
	command: string | undefined
	rest: ReadonlyArray<string>
}

// A value that is blank or another flag means the command itself was left out, which would otherwise
// swallow the next switch or hand its step nothing to run.
function is_command_value(value: string | undefined): value is string {
	return value !== undefined && value.trim() !== '' && !value.startsWith('-')
}

// The command arrives as the one argument after its flag and is removed together with it.
function split_command(args: ReadonlyArray<string>, flag: string): CommandSplit {
	const index = args.indexOf(flag)

	if (index === -1) return { command: undefined, rest: args }

	const value = args[index + 1]

	if (!is_command_value(value)) throw new Error(`Usage: ${START_USAGE}`)

	return { command: value, rest: args.filter((_, at) => at !== index && at !== index + 1) }
}

// The switches and the caller's commands are peeled off first, so what remains is exactly the
// `--profile` pair `josh init` accepts — one parser for the profile in both commands.
function parse_start_options(args: ReadonlyArray<string>): StartOptions {
	const init = split_command(args, INIT_COMMAND_FLAG)
	const { command: push_preflight_command, rest } = split_command(
		init.rest,
		PUSH_PREFLIGHT_COMMAND_FLAG,
	)
	const profile_args = rest.filter((argument) => !SWITCHES.has(argument))

	return {
		profile: project_profile.requested_profile(profile_args, START_USAGE),
		is_yes: rest.includes(YES_FLAG),
		is_github: rest.includes(GITHUB_FLAG),
		is_dry_run: rest.includes(DRY_RUN_FLAG),
		visibility: rest.includes(PUBLIC_FLAG) ? 'public' : 'private',
		init_command: init.command,
		push_preflight_command,
	}
}

function settle<T>(verdict: { value: T | undefined; refusal: string | undefined }): T {
	if (verdict.value === undefined) throw new Error(verdict.refusal)

	return verdict.value
}

function stop_on(refusal: string | undefined): void {
	if (refusal !== undefined) throw new Error(refusal)
}

// An unattended run already holds every answer: `--profile` or the detected one, and a consent that
// `github_consent` only grants when `--github` was given.
async function resolve_profile(
	choices: Choices,
	interaction: Interaction,
): Promise<ProjectProfile> {
	if (interaction === 'unattended') return choices.options.profile ?? choices.shape.profile

	return await start_prompt.confirm_choices(choices)
}

function planned_steps(root: string, shape: ProjectShape): ReadonlyArray<StartStep> {
	const state = start_steps.read_git_state(root, shape)
	const plan = start_plan.plan_steps(state)

	stop_on(plan.refusal)
	stop_on(start_steps.uncommitted_refusal(root, state))

	return plan.steps
}

// Every refusal is raised here, before the first write, so a run that stops here changed nothing.
function prepare(args: ReadonlyArray<string>, is_tty: boolean, root: string): Prepared {
	stop_on(start_steps.self_run_refusal(root))
	const options = parse_start_options(args)
	const interaction = settle(start_plan.interaction_of(options, is_tty))
	const shape = project_profile.inspect_project(root, options.profile)
	const steps = planned_steps(root, shape)
	const consent: Consent = settle(start_plan.github_consent(steps, options, interaction))

	stop_on(start_steps.github_cli_refusal(root))
	stop_on(start_steps.git_identity_refusal(steps, root))

	return { steps, interaction, choices: { options, shape, consent, root, steps } }
}

async function run_steps({ steps, interaction, choices }: Prepared): Promise<void> {
	const { root, options } = choices
	const { visibility, init_command, push_preflight_command } = options
	const profile = await resolve_profile(choices, interaction)
	const context = { root, profile, visibility, init_command, push_preflight_command }

	await start_steps.run_steps(steps, context)
	console.info(`\n${READY_MESSAGE}`)
}

// A dry run stops after the plan, adding what each step would create, before the first write.
async function main(args: ReadonlyArray<string>, is_tty: boolean): Promise<void> {
	const prepared = prepare(args, is_tty, process.cwd())
	const { steps, choices } = prepared

	console.info(start_plan.plan_summary(steps, start_plan.step_labels(choices.options.init_command)))

	if (choices.options.is_dry_run) {
		console.info(start_dry_run.report(choices))

		return
	}

	await run_steps(prepared)
}

async function run(args: ReadonlyArray<string>, is_tty: boolean): Promise<number> {
	try {
		await main(args, is_tty)

		return 0
	} catch (error) {
		console.error(error_text.message_of(error))

		return 1
	}
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await run(process.argv.slice(ARGUMENT_START_INDEX), process.stdin.isTTY)
}

const start = { run, parse_start_options }
export { start }

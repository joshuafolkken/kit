#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { error_text } from '#scripts/lib/error-message'
import { project_profile, type ProjectProfile } from './project-profile'
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
const START_USAGE = 'josh start [--profile basic|full] [--yes] [--github] [--public]'
const YES_FLAG = '--yes'
const GITHUB_FLAG = '--github'
const PUBLIC_FLAG = '--public'
const SWITCHES: ReadonlySet<string> = new Set([YES_FLAG, GITHUB_FLAG, PUBLIC_FLAG])

interface Prepared {
	steps: ReadonlyArray<StartStep>
	interaction: Interaction
	choices: Choices
}

// The switches are peeled off first, so what remains is exactly the `--profile` pair `josh init`
// accepts — one parser for the profile in both commands.
function parse_start_options(args: ReadonlyArray<string>): StartOptions {
	const profile_args = args.filter((argument) => !SWITCHES.has(argument))

	return {
		profile: project_profile.requested_profile(profile_args, START_USAGE),
		is_yes: args.includes(YES_FLAG),
		is_github: args.includes(GITHUB_FLAG),
		visibility: args.includes(PUBLIC_FLAG) ? 'public' : 'private',
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

// Every refusal is raised here, before the first write, so a run that stops here changed nothing.
function prepare(args: ReadonlyArray<string>, is_tty: boolean, root: string): Prepared {
	stop_on(start_steps.self_run_refusal(root))
	const options = parse_start_options(args)
	const interaction = settle(start_plan.interaction_of(options, is_tty))
	const shape = project_profile.inspect_project(root, options.profile)
	const plan = start_plan.plan_steps(start_steps.read_git_state(root, shape))

	stop_on(plan.refusal)
	const consent: Consent = settle(start_plan.github_consent(plan.steps, options, interaction))

	stop_on(start_steps.github_cli_refusal(root))

	return {
		steps: plan.steps,
		interaction,
		choices: { options, shape, consent, root, steps: plan.steps },
	}
}

async function main(args: ReadonlyArray<string>, is_tty: boolean): Promise<void> {
	const { steps, interaction, choices } = prepare(args, is_tty, process.cwd())

	console.info(start_plan.plan_summary(steps))
	const profile = await resolve_profile(choices, interaction)
	const { root, options } = choices

	await start_steps.run_steps(steps, { root, profile, visibility: options.visibility })
	console.info(`\n${READY_MESSAGE}`)
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

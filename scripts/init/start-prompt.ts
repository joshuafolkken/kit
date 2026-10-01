import path from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface, type Interface } from 'node:readline/promises'
import { ask_yes_no_simple } from '#scripts/git/git-prompt'
import { project_profile, type ProjectProfile, type ProjectShape } from './project-profile'
import type { Consent, StartOptions, StartStep } from './start-plan'

interface Choices {
	options: StartOptions
	shape: ProjectShape
	consent: Consent
	root: string
	steps: ReadonlyArray<StartStep>
}

const DECLINED =
	'Stopped before writing to GitHub. Nothing was changed. Run josh init to set up without GitHub.'
const SETUP_PR_QUESTION =
	'Open an Issue and a pull request on GitHub that add the kit setup to main? (y/n): '

// The detected profile is the default, so pressing Enter accepts it; the reason is shown because an
// ambiguous project is exactly the case this question exists for.
async function ask_profile(prompt: Interface, shape: ProjectShape): Promise<ProjectProfile> {
	const question = `Profile — basic or full [${shape.profile}, ${shape.reason}]: `
	const raw_answer = await prompt.question(question)
	const answer = raw_answer.trim()
	if (answer.length === 0) return shape.profile

	return project_profile.requested_profile(['--profile', answer]) ?? shape.profile
}

async function ask_or_stop(prompt: Interface, question: string): Promise<void> {
	if (!(await ask_yes_no_simple(prompt, question))) throw new Error(DECLINED)
}

// One question per GitHub write the plan holds, every one asked before the first step runs.
async function ask_github_writes(prompt: Interface, choices: Choices): Promise<void> {
	if (choices.steps.includes('repository')) {
		const name = path.basename(choices.root)

		await ask_or_stop(
			prompt,
			`Create a ${choices.options.visibility} GitHub repository "${name}" and push main? (y/n): `,
		)
	}

	if (choices.steps.includes('setup_pr')) await ask_or_stop(prompt, SETUP_PR_QUESTION)
}

async function ask_choices(prompt: Interface, choices: Choices): Promise<ProjectProfile> {
	const profile = choices.options.profile ?? (await ask_profile(prompt, choices.shape))
	if (choices.consent === 'ask') await ask_github_writes(prompt, choices)

	return profile
}

async function confirm_choices(choices: Choices): Promise<ProjectProfile> {
	const prompt = createInterface({ input, output })

	try {
		return await ask_choices(prompt, choices)
	} finally {
		prompt.close()
	}
}

const start_prompt = { confirm_choices }
export { start_prompt }
export type { Choices }

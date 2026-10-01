import path from 'node:path'
import { stdin as input, stdout as output } from 'node:process'
import { createInterface, type Interface } from 'node:readline/promises'
import { ask_yes_no_simple } from '#scripts/git/git-prompt'
import { project_profile, type ProjectProfile, type ProjectShape } from './project-profile'
import type { Consent, StartOptions } from './start-plan'

interface Choices {
	options: StartOptions
	shape: ProjectShape
	consent: Consent
	root: string
}

const DECLINED =
	'Stopped before creating the GitHub repository. Nothing was changed. Run josh init to set up without GitHub.'

// The detected profile is the default, so pressing Enter accepts it; the reason is shown because an
// ambiguous project is exactly the case this question exists for.
async function ask_profile(prompt: Interface, shape: ProjectShape): Promise<ProjectProfile> {
	const question = `Profile — basic or full [${shape.profile}, ${shape.reason}]: `
	const raw_answer = await prompt.question(question)
	const answer = raw_answer.trim()
	if (answer.length === 0) return shape.profile

	return project_profile.requested_profile(['--profile', answer]) ?? shape.profile
}

async function ask_repository(prompt: Interface, choices: Choices): Promise<void> {
	const name = path.basename(choices.root)
	const question = `Create a ${choices.options.visibility} GitHub repository "${name}" and push main? (y/n): `

	if (!(await ask_yes_no_simple(prompt, question))) throw new Error(DECLINED)
}

async function ask_choices(prompt: Interface, choices: Choices): Promise<ProjectProfile> {
	const profile = choices.options.profile ?? (await ask_profile(prompt, choices.shape))
	if (choices.consent === 'ask') await ask_repository(prompt, choices)

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

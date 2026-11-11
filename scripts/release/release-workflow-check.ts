import { changed_paths } from '#scripts/git/changed-paths'
import { git_command } from '#scripts/git/git-command'

// **A release needs a workflow that creates the GitHub Release.** The release merges its pull request,
// pushes the tag and moves `production` before it waits for the GitHub Release, and none of those can
// be taken back — so a repository whose default branch carries neither the distributed
// `github-release.yml` nor kit's own `publish.yml` is refused before anything is created
// (joshuafolkken/kit#7296). Both create the release by running `josh release:github`, so a file of
// that name which does not run it — a repository's own npm `publish.yml` — does not count.

const RELEASE_WORKFLOWS: ReadonlyArray<string> = [
	'.github/workflows/github-release.yml',
	'.github/workflows/publish.yml',
]
const RELEASE_STEP = 'josh release:github'
const DISTRIBUTED_SINCE = 'v1.1093.0'

function quoted(name: string): string {
	return `\`${name}\``
}

function missing_workflow_message(tip: string): string {
	return `No workflow on \`${tip}\` creates the GitHub Release (looked for ${RELEASE_WORKFLOWS.map((name) => quoted(name)).join(' or ')} running \`${RELEASE_STEP}\`), so the release would push its tag and then wait for a release that never comes. Upgrade kit to ${DISTRIBUTED_SINCE} or later and run \`pnpm josh sync\` to add \`github-release.yml\`, merge it, then run \`pnpm josh release\` again.`
}

function found_workflow_message(held: ReadonlyArray<string>): string {
	return `GitHub Release workflow: ${held.join(', ')}`
}

async function runs_release_step(tip: string, workflow: string): Promise<boolean> {
	const body = await git_command.show_file(`${tip}:${workflow}`)

	return body.includes(RELEASE_STEP)
}

async function read_release_workflows(tip: string): Promise<Array<string>> {
	const held = await changed_paths.read_held_at(tip, RELEASE_WORKFLOWS)
	const answers = await Promise.all(held.map((workflow) => runs_release_step(tip, workflow)))

	return held.filter((_workflow, index) => answers[index])
}

async function assert_release_workflow(tip: string): Promise<void> {
	const found = await read_release_workflows(tip)

	if (found.length === 0) throw new Error(missing_workflow_message(tip))

	console.info(found_workflow_message(found))
}

const release_workflow_check = {
	assert_release_workflow,
	found_workflow_message,
	missing_workflow_message,
}

export { release_workflow_check }

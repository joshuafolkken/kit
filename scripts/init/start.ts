#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { main as init_main } from './init'
import { project_profile, type ProjectShape } from './project-profile'

const ARGUMENT_START_INDEX = 2

function prerequisite(shape: ProjectShape): string | undefined {
	if (!shape.has_git) return 'josh start requires Git. Run git init, or use josh init without Git.'
	if (!shape.has_github) return 'josh start requires a GitHub origin. Add one, or use josh init.'

	return undefined
}

function main(args: ReadonlyArray<string> = []): void {
	// --profile uses the same override as josh init.
	const requested = project_profile.requested_profile(args)
	const shape = project_profile.inspect_project(process.cwd(), requested)
	const message = prerequisite(shape)
	if (message !== undefined) throw new Error(message)
	init_main(args)
	console.info('GitHub workflow ready. Use kickoff in your assistant to plan an Issue.')
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	main(process.argv.slice(ARGUMENT_START_INDEX))
}

const start = { prerequisite }
export { start }

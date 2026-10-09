#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { project_profile } from './project-profile'

const ARGUMENT_START_INDEX = 2
// A `ci.yml` synced before the profile rename matches `*'profile: static ('*` on this output to
// hand a basic project to `josh gate`. A consumer can upgrade kit without re-syncing that workflow,
// so a basic project keeps printing the old phrase on a line of its own until every workflow reads
// the new name.
const LEGACY_BASIC_LINE = 'compat: profile: static (the name before kit#2829)'

function describe(result: { profile: string; reason: string }): string {
	const line = `profile: ${result.profile} (${result.reason})`

	return result.profile === 'basic' ? `${line}\n${LEGACY_BASIC_LINE}` : line
}

function main(): void {
	const requested = project_profile.requested_profile(process.argv.slice(ARGUMENT_START_INDEX))
	const result = project_profile.resolve_profile(process.cwd(), requested)

	console.info(describe(result))
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

const project_profile_cli = { describe }
export { project_profile_cli }

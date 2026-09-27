#!/usr/bin/env tsx
import { fileURLToPath } from 'node:url'
import { project_profile } from './project-profile'

const ARGUMENT_START_INDEX = 2

function main(): void {
	const requested = project_profile.requested_profile(process.argv.slice(ARGUMENT_START_INDEX))
	const result = project_profile.resolve_profile(process.cwd(), requested)

	console.info(`profile: ${result.profile} (${result.reason})`)
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main()

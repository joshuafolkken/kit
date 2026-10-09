#!/usr/bin/env tsx
import { kit_version_config } from './kit-version-config'
import { version_check_arguments } from './version-check-arguments'
import { version_commands } from './version-commands'

// `version` shows the installed versions; `version --upgrade` updates both the global and the project
// @joshuafolkken/kit install, so the version surface is one command.
const UPGRADE_FLAG = '--upgrade'
const ARGUMENT_OFFSET = 2
const version_arguments = process.argv.slice(ARGUMENT_OFFSET)
const error = version_check_arguments.validate(version_arguments)

if (error) {
	console.error(error)
	process.exitCode = 1
} else if (version_arguments.includes(UPGRADE_FLAG)) {
	process.exit(version_commands.run_upgrade(kit_version_config))
} else {
	version_commands.run_check(kit_version_config)
}

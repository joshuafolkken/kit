#!/usr/bin/env tsx
import { kit_version_config } from './kit-version-config'
import { version_commands } from './version-commands'

// `version` shows the installed versions; `version --upgrade` updates both the global and the project
// @joshuafolkken/kit install. The upgrade was a separate `version:upgrade` command until
// joshuafolkken/kit#1928 folded it into this flag, so the version surface is one command again.
const UPGRADE_FLAG = '--upgrade'

if (process.argv.includes(UPGRADE_FLAG)) {
	process.exit(version_commands.run_upgrade(kit_version_config))
}

version_commands.run_check(kit_version_config)

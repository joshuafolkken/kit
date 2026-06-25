#!/usr/bin/env tsx
import { kit_version_config } from './kit-version-config'
import { version_commands } from './version-commands'

process.exit(version_commands.run_upgrade(kit_version_config))

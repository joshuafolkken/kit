#!/usr/bin/env tsx
import { kit_version_config } from './kit-version-config'
import { version_commands } from './version-commands'

version_commands.run_check(kit_version_config)

// Public entry point for the parameterized version-command library (`@joshuafolkken/kit/version`).
// Consumers (kit, jgame, app-kit) build a config with `create_version_command_config` and drive
// their `version` / `version:upgrade` commands through `version_commands`, passing only their own
// package name + GitHub Packages versions endpoint.
export type { VersionCommandConfig, VersionCommandConfigOptions } from './version-command-config'
export type { VersionSnapshot, RunningBinary, VersionOutputExtras } from './version-check-logic'
export { create_version_command_config } from './version-command-config'
export { version_commands } from './version-commands'

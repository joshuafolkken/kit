// Public entry point for the parameterized version-command library (`@joshuafolkken/kit/version`).
// Consumers (kit, jgame, app-kit) build a config with `create_version_command_config` and drive
// their `version` / `version:upgrade` commands through `version_commands`, passing only their own
// package name (endpoints are derived) plus an optional upstream chain, e.g.
// `upstreams: [kit_package_descriptor]` for app-kit.
export { KIT_PACKAGE_NAME, kit_package_descriptor } from './kit-descriptor'
export type {
	PackageVersionConfig,
	UpstreamDescriptor,
	VersionCommandConfig,
	VersionCommandConfigOptions,
} from './version-command-config'
export type {
	VersionSnapshot,
	RunningBinary,
	UpstreamReport,
	VersionOutputExtras,
} from './version-check-logic'
export { create_version_command_config, derive_versions_endpoint } from './version-command-config'
export { version_commands } from './version-commands'

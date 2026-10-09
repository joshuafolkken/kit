import { package_manager_version } from '#scripts/version/package-manager-version'
import semver from 'semver'

// pnpm sets `npm_config_user_agent` to `pnpm/<version> npm/? node/<version> <platform> <arch>` for
// every script and `pnpm exec` it runs, so the pnpm that invoked `josh init` is readable from it.
const PNPM_USER_AGENT_REGEX = /^pnpm\/(\S+)/u

function running_pnpm_version(user_agent = ''): string | undefined {
	const version = PNPM_USER_AGENT_REGEX.exec(user_agent)?.[1]

	return version === undefined ? undefined : (semver.valid(version) ?? undefined)
}

function is_older_than(kit_pin: string, version: string): boolean {
	const kit_version = semver.valid(package_manager_version.extract_pnpm_pin(kit_pin) ?? '')

	return kit_version !== null && semver.lt(kit_version, version)
}

// Never pin a project below the pnpm installing it: the lockfile that pnpm just wrote can name a
// version an older pnpm fails to resolve, so `pnpm install` under kit's older pin breaks the
// first `josh init`. The kit pin keeps its integrity suffix when it wins.
function choose(kit_pin: string | undefined, user_agent: string | undefined): string | undefined {
	const running = running_pnpm_version(user_agent)
	if (kit_pin === undefined || running === undefined) return kit_pin

	return is_older_than(kit_pin, running) ? `pnpm@${running}` : kit_pin
}

const package_manager_pin = {
	running_pnpm_version,
	choose,
}

export { package_manager_pin }

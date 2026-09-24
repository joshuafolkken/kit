import { existsSync, lstatSync, mkdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import path from 'node:path'
import { gh_cli_token } from '#scripts/gh/gh-cli-token'
import { PLATFORM_TEMP_ROOT } from '#scripts/josh/platform-temporary'
import { agent_role_profile, type AgentProfile } from './agent-role-profile'
import { codex_home_source } from './codex-home-source'

const OPENAI_PROVIDER = 'openai'
const REVIEWER_HOME = ['node_modules', '.cache', 'josh', 'openai', 'reviewer-home']
const HOME_FILES = ['auth.json', 'config.toml']
const PRIVATE_DIRECTORY_MODE = 0o700

type LaunchEnvironment = Readonly<Record<string, string | undefined>>

function openai_environment(): LaunchEnvironment {
	const token = gh_cli_token.get()

	return token === undefined
		? { TMPDIR: PLATFORM_TEMP_ROOT }
		: { GH_TOKEN: token, TMPDIR: PLATFORM_TEMP_ROOT }
}

function remove_old_home_link(source: string, target: string): boolean {
	const current = lstatSync(target, { throwIfNoEntry: false })

	if (current === undefined) return false
	if (!current.isSymbolicLink()) throw new Error(`Reviewer home file is not a link: ${target}`)
	if (existsSync(source) && readlinkSync(target) === source) return true

	unlinkSync(target)

	return false
}

function link_home_file(source_home: string, target_home: string, name: string): void {
	const source = path.join(source_home, name)
	const target = path.join(target_home, name)

	if (!remove_old_home_link(source, target) && existsSync(source)) symlinkSync(source, target)
}

// A nested reviewer cannot open the parent Codex installation ID for writing inside a lane sandbox.
// Keep credentials and user configuration readable, while its own mutable state stays in the lane.
function reviewer_home(cwd: string, environment: LaunchEnvironment): string {
	const source =
		environment['CODEX_HOME'] ?? process.env['CODEX_HOME'] ?? codex_home_source.default_home()
	const target = path.resolve(cwd, ...REVIEWER_HOME)

	mkdirSync(target, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
	for (const name of HOME_FILES) link_home_file(source, target, name)

	return target
}

function build(
	cwd: string,
	profile: AgentProfile | undefined,
	environment: LaunchEnvironment = {},
): LaunchEnvironment {
	if (profile?.provider !== OPENAI_PROVIDER) return environment

	const base = { ...openai_environment(), ...environment }

	return profile.role === agent_role_profile.REVIEWER
		? { ...base, CODEX_HOME: reviewer_home(cwd, environment) }
		: base
}

const agent_launch_environment = { build }

export { agent_launch_environment }

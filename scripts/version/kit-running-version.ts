import path from 'node:path'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'
import { running_binary } from './running-binary'

// The kit version the calling process runs — read off the package the running code was loaded from,
// never the checkout's package.json on disk, which a merge moves ahead of a process still running the
// old code. In kit itself the commits since the release follow it (`v1.3153.0+12`); an install under
// `node_modules` is the release itself, and a `git describe` there would describe the consumer.

const SELF_DIRECTORY = import.meta.dirname
const INSTALL_DIRECTORY = 'node_modules'
// `git describe --tags --long` ends in `-<commits since the tag>-g<hash>`.
const DESCRIBE_COUNT = /-(?<count>\d+)-g[\da-f]+$/u

function is_installed(root: string): boolean {
	return root.split(path.sep).includes(INSTALL_DIRECTORY)
}

// The commits the checkout at `root` is past its newest tag; none where git cannot say.
function commits_since_release(root: string): number {
	const described = git_spawn_sync.read(
		['describe', '--tags', '--long'],
		git_spawn_sync.located(root),
	)

	return Number(described?.match(DESCRIBE_COUNT)?.groups?.['count'] ?? 0)
}

// `v<version>`, `+<commits>` added in a kit checkout past its release; `undefined` where the
// package.json cannot be read.
function version_of(self_directory = SELF_DIRECTORY): string | undefined {
	const version = running_binary.read_running_version(self_directory)
	if (version === undefined) return undefined
	const root = running_binary.running_package_directory(self_directory)
	const count = is_installed(root) ? 0 : commits_since_release(root)

	return count > 0 ? `v${version}+${String(count)}` : `v${version}`
}

const kit_running_version = { version_of }

export { kit_running_version }

import { mkdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { git_location_environment } from '#scripts/git/git-location-environment'
import { git_spawn_sync } from '#scripts/git/git-spawn-sync'

// joshuafolkken/kit#6055, #6056: a scratch repository standing in for the checkout, ignoring
// `.josh/tmp/` the way the distributed `.gitignore` does — the tree every `*-file` reader's refusal
// is pinned against. A directory under `tmpdir()` outside it is the tree-outside case.

// The directory a body is written to when it should be refused: inside the tree, not ignored.
const UNIGNORED_DIRECTORY = 'drafts'
const IGNORED_DIRECTORY = '.josh/tmp'
const BODY_NAME = 'body.md'

interface BodyRepository {
	root: string
	write: (directory: string, text: string) => string
}

// `root` is an empty directory the suite's `temporary_directory` creator made, so it removes it too.
function create(root: string): BodyRepository {
	git_spawn_sync.run(['init', '--quiet'], {
		cwd: root,
		env: git_location_environment.location_free_environment(),
	})
	writeFileSync(path.join(root, '.gitignore'), `${IGNORED_DIRECTORY}/\n`)

	return {
		root,
		write: (directory, text) => {
			const absolute_directory = path.join(root, directory)
			const target = path.join(absolute_directory, BODY_NAME)

			mkdirSync(absolute_directory, { recursive: true })
			writeFileSync(target, text)

			return target
		},
	}
}

const cli_body_repository = { UNIGNORED_DIRECTORY, IGNORED_DIRECTORY, create }

export { cli_body_repository }
export type { BodyRepository }

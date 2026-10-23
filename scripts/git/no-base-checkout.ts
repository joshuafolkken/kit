import {
	copyFileSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	symlinkSync,
	writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execa } from 'execa'
import { changed_paths } from './changed-paths'
import { git_command } from './git-command'
import { git_location_environment } from './git-location-environment'

// **A checkout of this tree as CI's `actions/checkout` hands it over** — a detached, depth-one `HEAD`
// with no local default branch, no `origin` and so no remote-tracking ref (joshuafolkken/kit#4710).
// Code that passes `main` to git reads the local branch every lane has and passes here, then fails
// in CI with `bad revision 'main'`; run inside this checkout, it fails here too.
//
// **No object is copied**: the objects are borrowed through `objects/info/alternates`, and only the
// tree is checked out. The work in progress is copied over it, and `node_modules` is linked, so the
// tests read what the lane's own run reads.

const CHECKOUT_PREFIX = 'josh-no-base-'
const NODE_MODULES = 'node_modules'

// Cleared rather than inherited: under a git hook `GIT_DIR` beats `cwd`, and every command here must
// act on the new checkout.
async function git(cwd: string, arguments_: ReadonlyArray<string>): Promise<string> {
	const { stdout } = await execa('git', arguments_, {
		cwd,
		env: git_location_environment.location_free_environment(),
		extendEnv: true,
	})

	return stdout.trim()
}

// A file the work deleted is deleted from the checkout too. A directory git names as one path — a
// nested repository, a submodule — is not the work's to copy.
function copy_work(root: string, directory: string, file: string): void {
	const source = path.join(root, file)
	const target = path.join(directory, file)

	if (!existsSync(source)) {
		rmSync(target, { force: true })

		return
	}

	if (statSync(source).isDirectory()) return

	mkdirSync(path.dirname(target), { recursive: true })
	copyFileSync(source, target)
}

async function borrow_objects(root: string, directory: string): Promise<void> {
	const common = await git(root, ['rev-parse', '--path-format=absolute', '--git-common-dir'])
	const alternates = path.join(directory, '.git', 'objects', 'info', 'alternates')

	writeFileSync(alternates, `${path.join(common, 'objects')}\n`)
}

function link_dependencies(root: string, directory: string): void {
	const source = path.join(root, NODE_MODULES)

	if (existsSync(source)) symlinkSync(source, path.join(directory, NODE_MODULES))
}

// `root` is the repository the checkout is cut from; the work in progress is read from the process's
// own repository, which is the same one wherever `josh test:related` calls this.
async function check_out(root: string, directory: string, head: string): Promise<void> {
	await git(directory, ['init', '--quiet'])
	await borrow_objects(root, directory)
	await git(directory, ['checkout', '--quiet', '--detach', head])
	writeFileSync(path.join(directory, '.git', 'shallow'), `${head}\n`)
}

async function fill(root: string, directory: string): Promise<void> {
	const head = await git_command.head_commit()

	await check_out(root, directory, head)
	link_dependencies(root, directory)

	const work = await changed_paths.read_changed_since(head)

	for (const file of work) copy_work(root, directory, file)
}

function remove(directory: string): void {
	rmSync(directory, { force: true, recursive: true })
}

// A checkout that could not be finished is removed before the failure is passed on.
async function create(root: string): Promise<string> {
	const directory = mkdtempSync(path.join(tmpdir(), CHECKOUT_PREFIX))

	try {
		await fill(root, directory)
	} catch (error) {
		remove(directory)
		throw error
	}

	return directory
}

const no_base_checkout = { create, remove }

export { no_base_checkout }

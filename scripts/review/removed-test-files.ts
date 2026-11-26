// **A test file the change deleted whole is disposed of by one row naming the file**
// (joshuafolkken/kit#8927). One row per removed test was the only form, and a change that deleted 104
// test files removed 769 tests whose rows alone outgrew a pull request body (65,536 characters), so no
// body could pass the check. A row naming a deleted file reads as disposing of every test that file
// held; a file the change only edited keeps one row per removed test.
//
// **A file row never disposes of a test another file still holds.** A title the deleted file shares
// with a file the change kept is left out of the file's titles, so its removal from the kept file still
// needs a row of its own.

// A test file the change deleted, with the titles its one row disposes of.
interface RemovedFile {
	path: string
	titles: ReadonlyArray<string>
}

// A changed test file at the base: its path and the full names of the tests it held there.
type BaseFile = RemovedFile

function kept_titles(
	files: ReadonlyArray<BaseFile>,
	is_deleted: (path: string) => boolean,
): ReadonlySet<string> {
	return new Set(files.filter((file) => !is_deleted(file.path)).flatMap((file) => file.titles))
}

function wholly_removed(
	files: ReadonlyArray<BaseFile>,
	is_deleted: (path: string) => boolean,
): ReadonlyArray<RemovedFile> {
	const kept = kept_titles(files, is_deleted)

	return files
		.filter((file) => is_deleted(file.path))
		.map((file) => ({ path: file.path, titles: file.titles.filter((title) => !kept.has(title)) }))
}

// The titles a body's cited names dispose of: each named title, and every title of each named file.
function disposed_by(
	names: ReadonlySet<string | undefined>,
	files: ReadonlyArray<RemovedFile>,
): ReadonlySet<string | undefined> {
	const of_files = files.filter((file) => names.has(file.path)).flatMap((file) => file.titles)

	return new Set([...names, ...of_files])
}

// The names the pending rows go under: a deleted file any of whose titles is still open, once, in its
// place, and each other open title as itself. A renamed title keeps its own row, written filled with
// its new title, so the file row never swallows a replacement the check already knows.
function pending_names(
	titles: ReadonlyArray<string>,
	files: ReadonlyArray<RemovedFile>,
	renamed: ReadonlySet<string> = new Set(),
): ReadonlyArray<string> {
	const open = new Set(titles.filter((title) => !renamed.has(title)))
	const named = files.filter((file) => file.titles.some((title) => open.has(title)))
	const covered = new Set(named.flatMap((file) => file.titles).filter((title) => open.has(title)))

	return [...named.map((file) => file.path), ...titles.filter((title) => !covered.has(title))]
}

const removed_test_files = { disposed_by, pending_names, wholly_removed }

export type { BaseFile, RemovedFile }
export { removed_test_files }

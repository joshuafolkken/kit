// Shared manifest shape for every suite that exercises the packageManager /
// devEngines alignment — the alignment unit tests, the sync + post-bump tests,
// and the init merge test. They all assert on byte-for-byte output, so the
// layout lives here instead of being re-declared (and drifting) in each file.
// `package_manager` is optional because one no-op case needs a manifest without
// the field at all.
function build_package_manager_manifest(
	package_manager: string | undefined,
	development_engines_version: string,
): string {
	const package_manager_line =
		package_manager === undefined ? '' : `\t"packageManager": "${package_manager}",\n`

	return `{\n\t"name": "demo",\n${package_manager_line}\t"devEngines": {\n\t\t"packageManager": {\n\t\t\t"name": "pnpm",\n\t\t\t"version": "${development_engines_version}",\n\t\t\t"onFail": "error"\n\t\t}\n\t}\n}\n`
}

export { build_package_manager_manifest }

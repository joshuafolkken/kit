# Release

For kit maintainers publishing a new version of `@joshuafolkken/kit`; projects that use kit can skip this page.

## When to use it

Merged work has landed since the last version change and you want it published. A person runs the release; no workflow keyword does.

## Steps

1. Ask whether a release is owed with [`josh release:scope`](../josh-commands-automation.md#josh-releasescope). `unknown` never means skip.
2. Run [`josh release`](../josh-commands-automation.md#josh-release). It raises the version from the merges since the last one, merges the release pull request and waits for the version tag. Its dry-run option only reports.
3. The tag starts the publish jobs to GitHub Packages and public npm ([publishing.md](./publishing.md#publishing-to-public-npm)).

[`josh bump`](../josh-commands-automation.md#josh-bump) is the manual alternative; after a manual bump, update `docs/` before committing.

## Check it worked

- `josh release` ends with the tag found.
- The public registry serves the new version — query it the way [publishing.md](./publishing.md#one-time-public-npm-setup) describes, since a plain lookup can answer from GitHub Packages.

## Common failures

- The release branch already exists, the default branch cannot be read, or the tag never appears: `josh release` stops and says which ([`josh release`](../josh-commands-automation.md#josh-release)).
- One registry has the version and the other does not: the two publish jobs run separately and one can fail while the other succeeds, so check each job's result ([publishing.md](./publishing.md#publishing-to-public-npm)).

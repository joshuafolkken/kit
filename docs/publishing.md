# Publishing to public npm

Kit publishes each release to GitHub Packages and public npm in separate jobs. Both jobs check out the tag carried by the release event, so they publish the same source revision. A failure in one job does not prevent the other job from running.

## One-time public npm setup

An npm account that owns the `@joshuafolkken` scope must publish the package once before its trusted publisher can be configured. Confirm that the account controls the scope, then inspect the tarball produced by `pnpm pack` before the first publish. The repository is public, but the tarball includes the distributed prompts, scripts, and AI configuration as well as compiled code.

From a checkout of the release tag, run `pnpm pack --out /tmp/kit.tgz` and inspect the archive. Then, from outside this repository, use an authenticated npm CLI to run `npm publish /tmp/kit.tgz --access public --registry https://registry.npmjs.org`. Running the npm command outside the pnpm project avoids its `devEngines.packageManager` check. Do not publish a version that already exists on public npm.

Once the package exists on npmjs.com, open its **Settings → Trusted publishing** page and add a GitHub Actions publisher with user or organization `joshuafolkken`, repository `kit`, and workflow filename `publish.yml`. Select the option that permits **direct `npm publish`**. New trusted publishers may permit staged publishing only by default; the release workflow uses direct publishing. The workflow grants `id-token: write` to the public npm job and uses npm's short-lived OIDC credentials, so it needs no long-lived npm token. See the [npm trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

After a release, verify the public registry directly without a local scope mapping: `curl -fsS 'https://registry.npmjs.org/@joshuafolkken%2fkit'`. Check the expected version there and in GitHub Packages. A normal `npm view` on a maintainer's computer may silently use the `@joshuafolkken` mapping from `~/.npmrc` and report the GitHub Packages copy instead.

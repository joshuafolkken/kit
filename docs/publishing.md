# Publishing to public npm

Kit publishes each release to GitHub Packages and public npm in separate jobs. Both jobs check out the tag carried by the release event, so they publish the same source revision. A failure in one job does not prevent the other job from running.

## One-time public npm setup

An npm account that owns the `@joshuafolkken` scope must publish the package once before its trusted publisher can be configured. Confirm that the account controls the scope and [enable two-factor authentication](https://docs.npmjs.com/configuring-two-factor-authentication/): npm requires it for the first direct publish. Complete any browser authentication in the browser; never share authentication or recovery codes. Inspect the tarball before publishing. The repository is public, but the tarball includes the distributed prompts, scripts, and AI configuration as well as compiled code.

From a checkout of the release tag, create and inspect the tarball:

```bash
pnpm pack --out /tmp/kit.tgz
tar -tzf /tmp/kit.tgz | less
```

Older release tags may carry `publishConfig.registry` pointing to GitHub Packages. Publishing that tarball directly can target GitHub Packages even with `--registry` on the command line. Unpack it into a temporary directory, remove only the registry selection from the packaged manifest, and repack it. This leaves the release checkout untouched:

```bash
KIT_PUBLIC_DIR=$(mktemp -d)
tar -xzf /tmp/kit.tgz -C "$KIT_PUBLIC_DIR"
cd "$KIT_PUBLIC_DIR/package"
pnpm pkg delete publishConfig
pnpm pack --out /tmp/kit-public.tgz
```

Publish from outside the pnpm project to avoid its `devEngines.packageManager` check. A maintainer's `~/.npmrc` may route the entire `@joshuafolkken` scope to GitHub Packages; `--registry` alone does not override that mapping. Set the scope registry for this command as well:

```bash
cd /tmp
npm login --registry=https://registry.npmjs.org
npm whoami --registry=https://registry.npmjs.org
npm publish /tmp/kit-public.tgz --access public --registry=https://registry.npmjs.org '--@joshuafolkken:registry=https://registry.npmjs.org'
```

Complete any browser authentication prompt. Check the public npm registry before publishing: a version already published there cannot be published again. The same version in GitHub Packages does not prevent its first publication to public npm.

Once the package exists on npmjs.com, open its **Settings → Trusted publishing** page and add a GitHub Actions publisher with user or organization `joshuafolkken`, repository `kit`, and workflow filename `publish.yml`. Select the option that permits **direct `npm publish`**. New trusted publishers may permit staged publishing only by default; the release workflow uses direct publishing. The workflow grants `id-token: write` to the public npm job and uses npm's short-lived OIDC credentials, so it needs no long-lived npm token. See the [npm trusted publishing guide](https://docs.npmjs.com/trusted-publishers/).

After a release, verify the public registry directly without a local scope mapping:

```bash
curl -fsS 'https://registry.npmjs.org/@joshuafolkken%2fkit'
cd /tmp
npm view @joshuafolkken/kit version --userconfig /dev/null '--@joshuafolkken:registry=https://registry.npmjs.org'
```

Check the expected version and `latest` there and verify that the same version remains in GitHub Packages. Immediately after a first publish, the version-specific metadata and tarball may become available before the package-wide metadata. Continue checking until the normal installation route resolves. A plain `npm view` on a maintainer's computer may silently use the `@joshuafolkken` mapping from `~/.npmrc` and report the GitHub Packages copy instead.

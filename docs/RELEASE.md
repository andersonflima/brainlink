# Release

Brainlink releases are built from the CLI package. Do not publish until the package name, npm account and version are confirmed.

## Beta Release Checklist

1. Confirm `package.json` name, version, repository, license and bin entries.
2. Run `npm install` from a clean checkout when dependencies changed.
3. Run `npm run check`.
4. Run `npm run pack:smoke`.
5. Run a global install smoke from the generated tarball.
6. Verify both binaries:

```bash
brainlink --help
blink --help
```

7. Verify core CLI flow:

```bash
blink init ./tmp-vault
blink add "Release Smoke" --vault ./tmp-vault --content "Release smoke note. #release"
blink index --vault ./tmp-vault --json
blink search "release smoke" --vault ./tmp-vault --mode hybrid --json
blink context "release smoke" --vault ./tmp-vault --mode hybrid --json
```

8. Verify HTTP graph server starts:

```bash
blink server --vault ./tmp-vault --host 127.0.0.1 --port 4321
```

9. Verify the server refuses public binds:

```bash
blink server --vault ./tmp-vault --host 0.0.0.0
```

10. Confirm no test/demo vault files are included in the package tarball.
11. Confirm the repository has an `NPM_TOKEN` secret with publish permission for `@andespindola/brainlink`.
12. Create the git tag only after the package name is final.
13. Publish from GitHub Actions by publishing a GitHub Release for the tag.

## Publish Commands

The preferred path is the `Publish npm` GitHub Actions workflow:

- Push to `main`: runs checks, pack smoke, then publishes the package to npm with `latest` when `package.json` contains a version that is not already published.
- GitHub Release `published`: runs checks, pack smoke, then publishes to npm with provenance.
- Manual `workflow_dispatch`: runs a dry run by default. Disable `dry_run` only for an intentional manual publish.
- Manual `workflow_dispatch` accepts an optional `dist_tag` override. Use `latest` only when the default npm install command should resolve to that version.
- Prerelease versions publish under their prerelease dist-tag, for example `0.1.0-beta.1` publishes with `--tag beta`.

On `main`, the publish job checks npm before publishing. If the version already exists, it automatically bumps the package inside the runner to the next available version before checks, packing and publishing. For example, `0.1.0-beta.4` becomes `0.1.0-beta.5`.

The automatic bump is intentionally not pushed back to `main`. The branch stays protected, and npm remains the source of truth for the latest published package version.

Manual and GitHub Release publishes do not auto-bump. If their version already exists, they skip `npm publish` because npm versions are immutable.

For emergency local publishing of scoped public packages:

```bash
npm publish --access public
```

For unscoped packages:

```bash
npm publish
```

## Current Package Name Constraint

`brainlink` is already present on npm. `@brainlink` alone is not a valid npm package name because scoped packages must use `@scope/name`.

Valid alternatives:

- `@andespindola/brainlink`
- `@brainlink/cli`, if the publisher controls the `@brainlink` scope
- another unscoped name that is available on npm

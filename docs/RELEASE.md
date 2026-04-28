# Release

Brainlink releases are built from the CLI package. Do not publish until the package name, npm account and version are confirmed.

## Alpha Release Checklist

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

9. Confirm no test/demo vault files are included in the package tarball.
10. Create the git tag only after the package name is final.
11. Publish only from a logged-in npm account with permission for the package name.

## Publish Commands

For scoped public packages:

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

- `@andersonespindola/brainlink`
- `@brainlink/cli`, if the publisher controls the `@brainlink` scope
- another unscoped name that is available on npm

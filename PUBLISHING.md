# Publishing

The extension targets two registries:

- **VS Marketplace** — used by VSCode.
- **Open VSX** — used by Cursor (and VSCodium, Gitpod, etc.).

Publisher/namespace: **`aniusch`** (must match `publisher` in `package.json` on
both registries). Version comes from `package.json` `version` — bump it before
each release (`npm version patch`).

---

## One-time setup

### VS Marketplace

1. Create an **Azure DevOps** organization: https://dev.azure.com (free).
2. Create the publisher **`aniusch`**: https://marketplace.visualstudio.com/manage/createpublisher
   (the ID must equal `package.json` → `publisher`).
3. Create a **Personal Access Token (PAT)**: Azure DevOps → *User settings* →
   *Personal Access Tokens* → *New Token*:
   - **Organization:** *All accessible organizations*
   - **Scopes:** *Marketplace → Manage*
   - Copy the token (shown once).

### Open VSX

1. Sign in with GitHub: https://open-vsx.org
2. Create an access token: https://open-vsx.org/user-settings/tokens
3. Sign the **Eclipse Foundation Publisher Agreement** (prompted on first publish,
   or under *User Settings*). Required — publishing fails without it.
4. The namespace `aniusch` is created in the publish step below.

---

## Publish a release

Bump the version first (updates `package.json` and the `publish:ovsx` filename if
you keep it in sync):

```bash
npm version patch      # 0.0.1 -> 0.0.2
```

### VS Marketplace

```bash
export VSCE_PAT=<your-marketplace-PAT>
npm run publish:vsce
```

(`vsce publish` runs the bundle build via `vscode:prepublish`, packages, and
uploads. Alternatively `npx @vscode/vsce login aniusch` once, then `vsce publish`.)

### Open VSX

```bash
npm run package                                    # build the .vsix
export OVSX_PAT=<your-open-vsx-token>
npx --yes ovsx create-namespace aniusch            # first release only
npm run publish:ovsx                               # publishes the .vsix
```

> If you bump the version, update the filename in the `publish:ovsx` script (or
> run `npx ovsx publish <new-file>.vsix`).

---

## Verify

- Marketplace: `https://marketplace.visualstudio.com/items?itemName=aniusch.inline-image-preview`
- Open VSX: `https://open-vsx.org/extension/aniusch/inline-image-preview`

Both can take a few minutes to index after upload.

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

Bump the version first:

```bash
npm version patch      # 0.0.1 -> 0.0.2  (use `minor` for new features)
```

### VS Marketplace

```bash
export VSCE_PAT=<your-marketplace-PAT>
npm run publish:vsce
```

(`vsce publish` packages the current version and uploads it. Alternatively
`npx @vscode/vsce login aniusch` once, then `vsce publish`.)

### Open VSX

```bash
export OVSX_PAT=<your-open-vsx-token>
npx --yes ovsx create-namespace aniusch    # first release only, ignore if it exists
npm run publish:ovsx                        # packages + publishes the current version
```

Both `publish:*` scripts pick up the version from `package.json` — no filenames
to keep in sync.

---

## Verify

- Marketplace: `https://marketplace.visualstudio.com/items?itemName=aniusch.inline-image-preview`
- Open VSX: `https://open-vsx.org/extension/aniusch/inline-image-preview`

Both can take a few minutes to index after upload.



## Problem

The portal link uses `window.location.origin`, which in the admin's preview returns the Lovable preview URL (e.g., `https://id-preview--xxx.lovable.app`). This URL is protected by Lovable's platform authentication, so when a client clicks it, they land on Lovable's login page instead of the app's login page.

The correct link should point to the **published URL** (`https://sistema-gpi.lovable.app`), which is publicly accessible.

## Solution

1. **Add an environment variable** `VITE_APP_URL` with the published domain, so the portal link always points to the correct public URL.

2. **Update `PortalTab.tsx`** — replace all `window.location.origin` references for the portal link with `import.meta.env.VITE_APP_URL || window.location.origin`.

3. **Update `UsuariosPortalPage.tsx`** — same fix for any portal link references there.

4. **Update `ClientePortalPage.tsx`** — no changes needed (this runs on the client side where `window.location.origin` is correct).

### Technical detail

Since `.env` is auto-managed, we'll define a constant in a shared util or directly in each file:

```typescript
const PORTAL_BASE_URL = import.meta.env.VITE_APP_URL || window.location.origin;
const portalLink = `${PORTAL_BASE_URL}/cliente`;
```

The env var `VITE_APP_URL` will need to be set to `https://sistema-gpi.lovable.app` (or a future custom domain). Since `.env` cannot be edited directly, we'll use the secrets tool to add it, or alternatively hardcode the published URL as a fallback constant.

**Alternative (simpler, no env var):** Since the published URL is known and stable, define a constant:
```typescript
const PUBLISHED_URL = 'https://sistema-gpi.lovable.app';
const portalLink = `${PUBLISHED_URL}/cliente`;
```

This is more reliable and avoids env var management. If the domain changes, it's one constant to update.

### Files to modify
- `src/components/clientes/PortalTab.tsx` — update `portalLink` and message template
- `src/pages/UsuariosPortalPage.tsx` — update portal link references


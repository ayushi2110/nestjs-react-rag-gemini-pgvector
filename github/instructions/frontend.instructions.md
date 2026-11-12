# Frontend instructions

Applies to `frontend/src/**/*.{ts,tsx,css}`.

## Existing structure

- `App.tsx` composes the main layout and manages input/sidebar presentation.
- `components/` contains `ChatMessage`, `SourceCard`, and `UploadPanel`.
- `hooks/useChat.ts` currently contains chat state plus HTTP helpers for chat,
  while `hooks/useAdminAuth.ts` exposes the protected admin session.
- Admin routes/pages live under `pages/`, with shared auth context/provider under
  `contexts/`. `api/adminApi.ts` makes authenticated document-management calls.
- `types/index.ts` contains shared frontend message and API response types.
- `index.css` contains global styles and CSS custom properties.

Follow the current structure; do not assume there are separate API or
component-specific style directories.

## React and TypeScript

- Use function components and hooks; preserve the existing named exports for
  reusable components and the default export for `App`.
- Type component props and API data. Avoid introducing `any` or unchecked
  assumptions about network responses.
- Keep chat messages in the `useChat` hook and presentational rendering in
  components. Keep `UploadPanel` inside protected admin pages, never in the
  public chat layout.
- Keep the API contract aligned with the backend: `/api/chat`,
  `/api/documents/ingest`, `/api/documents/upload`, and `/api/documents/stats`.
- Build the API base from `VITE_API_URL` when configured; otherwise use `/api`
  (proxied to the backend by Vite during development).
- Check `Response.ok` and present actionable error text. A statistics-load
  failure is intentionally non-critical.

## Styling and interaction

- Use the existing global `index.css` and design tokens. Avoid adding a styling
  framework or per-component CSS architecture without an explicit requirement.
- Preserve the current dark chat layout, responsive behavior, source expansion,
  and upload/text-ingestion interactions.
- Keep labels and accessible names for interactive controls; use semantic
  buttons/forms and preserve keyboard submit behavior (Enter sends,
  Shift+Enter adds a newline).

## Verification

From `frontend/`, run `npm run build` to type-check and build, and `npm run lint`
for ESLint. No frontend test runner is currently configured.
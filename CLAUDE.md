# EquipSheet (设备资料单生成器)

Bilingual (Chinese/English) equipment data sheet editor for the second-hand equipment sales market. Single-page Vue 3 app with a form editor on the left and live A4 landscape preview on the right.

## Tech Stack
- Vue 3 (Composition API, `<script setup>`)
- Vite 7 (build tool + dev server)
- Naive UI (component library)
- IndexedDB (local persistence, raw API)
- JSZip (backup export/import)
- MyMemory Translated API (auto translation, proxied through Vite dev middleware and Vercel serverless function)
- Deployed via GitHub Pages and Vercel

## Project Structure
```
src/
├── App.vue                  # Main editor — state, undo/redo, translation, print, CRUD
├── main.js                  # Vue bootstrap with NConfigProvider + NDialogProvider
├── styles.css               # All global styles (1785 lines)
├── document-model.js        # State schema, defaults, cloning, serialization
├── backup-format.js         # ZIP export/import with SHA-256 asset dedup
├── storage.js               # IndexedDB persistence layer
├── naive-theme.js           # Naive UI theme overrides
├── composables/             # Vue composables (extracted from App.vue)
│   ├── useDocument.js       # Document state, undo/redo, page CRUD, save scheduling
│   ├── useTranslation.js    # Translation cache, debounce, MyMemory API calls
│   └── usePrint.js          # Print preparation, DOM cloning, asset waiting
└── components/
    ├── SheetPreview.vue     # Single A4 sheet preview (print-only rendering)
    ├── EditorPanel.vue      # Collapsible editor panel wrapper
    └── ...                  # Other extracted editor sub-components
api/
└── translate.js             # Vercel serverless function (MyMemory proxy)
vite-plugin-translate.js     # Vite dev middleware (MyMemory proxy)
```

## Key Architecture Decisions
- **State model**: Reactive `appState` object with `version`, `activePageId`, and `pages[]`. Each page has bilingual fields, images (as data URLs), terms, and layout config.
- **Undo/redo**: Full state snapshots (max 80). `pushHistorySnapshot()` before every mutation, `snapshotKey()` for dedup. Trade-off: memory-heavy with large images.
- **Translation**: Debounced (1s), LRU-cached (500 entries), auto-pauses on MyMemory daily quota exceeded. Proxy through Vite/Vercel to avoid CORS.
- **Backup**: ZIP with `version.json`, `pages.json`, and deduplicated `assets/` folder. Images referenced by hash-based filenames in JSON.
- **Print**: On `beforeprint`, clones all sheet DOM nodes into `#export-root`, applies `@page { size: A4 landscape }` CSS. Cleans up on `afterprint`.

## Conventions
- Plain JavaScript (no TypeScript yet — planned)
- Vue SFC with `<script setup>` (Composition API)
- Chinese comments and UI text
- CSS variables for theming (`--accent`, `--ink`, `--bg`, etc.)
- IDs use `equip-sheet-editor-` prefix pattern via `getControlId()`
- Image data stored as data URLs throughout the state (being refactored to separate storage)

## Common Commands
- `npm run dev` — Start Vite dev server (port 5173)
- `npm run build` — Production build to `dist/`
- `npm run preview` — Preview production build (port 4173)

## Git
- Branch: `main`
- Deploy on push to main via GitHub Actions (`deploy.yml`)

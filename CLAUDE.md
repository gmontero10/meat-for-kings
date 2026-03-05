# Meat for Kings

Grill product catalog web app **in Spanish**. 1,505 products across 11 categories scraped from BBQGuys.com and translated to Spanish.

**Live site:** https://meat-for-kings.onrender.com/

## Quick Start

```bash
cd ~/Meat\ for\ Kings
python3 app.py          # http://localhost:8000
```

## Deployment

Hosted on **Render** (free tier). Auto-deploys on every push to `main` via Render's GitHub integration.

- **Repo:** https://github.com/gmontero10/meat-for-kings
- **Config:** `render.yaml` (Render Blueprint)
- **Production server:** gunicorn (`gunicorn app:app --bind 0.0.0.0:$PORT`)
- **Build command:** `pip install -r requirements.txt && python -c "from app import ensure_indexes; ensure_indexes()"`

The SQLite DB is read-only at runtime and ships with each deploy. Render's free tier filesystem is ephemeral, which is fine since we never write to the DB.

## Architecture

**Stack:** Flask + SQLite + vanilla JS (no build step, no framework).

| File | Role |
|------|------|
| `app.py` | Flask server, 6 routes (3 HTML + 3 JSON API) |
| `templates/home.html` | Dark luxury landing page — self-contained (inline CSS/JS), no shared assets with catalog |
| `templates/cuts_menu-es.html` | Cortes (cuts) menu page — self-contained (inline CSS/JS), category filtering, static product cards |
| `templates/catalog.html` | Jinja2 shell — header, sidebar, grid, modal |
| `static/js/app.js` | IIFE-wrapped SPA — state, API calls, rendering, events (catalog only) |
| `static/css/style.css` | Catalog design system with CSS custom properties |
| `catalog-es.db` | SQLite, single `products` table, Spanish-translated, read-only at runtime |
| `render.yaml` | Render Blueprint — build/start commands, free tier |
| `scrape.py` | Playwright scraper (standalone, do not modify) |

## Database

Single `products` table. Prices are **integers in cents** (e.g. 49999 = $499.99). `bullet_points` is a JSON-encoded string array. `product_url` is relative (needs `https://www.bbqguys.com` prefix). `id` is TEXT not INTEGER.

**NULL prevalence:** 62.8% have NULL `fuel_type`. 69% have NULL `rating`. 62.8% have NULL `description`. Handle NULLs gracefully everywhere.

**Language:** All product names, descriptions, bullet points, categories, and fuel types are in Spanish. Stock status values remain English (`IN_STOCK`, `OUT_OF_STOCK`, `LIMITED_SUPPLY`) in the DB; the UI displays them in Spanish.

Seven indexes exist: `idx_brand`, `idx_price`, `idx_fuel`, `idx_stock`, `idx_rating`, `idx_name`, `idx_category`.

## API Endpoints

- `GET /` — serves home.html (dark luxury landing page)
- `GET /cortes` — serves cuts_menu-es.html (meat cuts menu with category filtering)
- `GET /catalog` — serves catalog.html (product catalog with filters, search, infinite scroll)
- `GET /api/filters` — brands list, fuel types, price range, total count
- `GET /api/products` — paginated, filtered, sorted product list (16 card-display fields)
  - Params: `page`, `per_page`(36), `sort`, `search`, `brand`(comma-sep), `fuel_type`(comma-sep), `min_price`, `max_price`, `in_stock`, `has_rating`
  - Sort values: `price_asc`, `price_desc`, `name_asc`, `rating_desc`, `savings_desc`
- `GET /api/products/<id>` — full product detail, parses `bullet_points` JSON

## Frontend Patterns

- **State object** at top of IIFE drives all behavior
- **Event delegation** on `#product-grid` and `#brand-list` for dynamic content
- **AbortController** cancels in-flight search requests on new input
- **Two IntersectionObservers:** one for infinite scroll (sentinel div, 200px margin), one for lazy images (`data-src` swap, 300px margin)
- **Debounce:** search at 300ms, price inputs at 500ms
- **HTML sanitization:** DOMParser-based allowlist (`h3, h4, p, b, strong, em, br, ul, li, ol`) for product descriptions
- **`escapeHtml()`** on all user-facing dynamic text

## CSS Design System

Warm luxury palette with gold accent (`#C8963E`). Fonts: Playfair Display (headings) + Inter (body). All tokens in `:root` custom properties. Responsive breakpoints: 1400px (4-col), 1024px (3-col), 768px (2-col + mobile sidebar overlay), 480px (1-col).

## Common Tasks

**Add a new filter:** Add param handling in `api_products()` → add UI element in `catalog.html` → bind change event in `bindEvents()` → add to `state.filters` + `buildParams()` + `updateFilterTags()` + `removeFilter()` + `clearAllFilters()`.

**Add a new sort option:** Add to `sort_map` in `app.py` → add `<option>` in `catalog.html`.

**Change card layout:** Edit `productCard()` in `app.js` + `.product-card` styles in `style.css`.

**Change modal content:** Edit `renderModal()` in `app.js` + `.modal-*` styles in `style.css`.

## Do Not

- Modify `scrape.py` or `catalog-es.db` directly
- Add a build step or framework — this is intentionally vanilla
- Remove the `escapeHtml()` / `sanitizeHtml()` calls (XSS protection)
- Use port 5000 (blocked by macOS AirPlay Receiver)
- Remove `gunicorn` from requirements.txt (needed for production on Render)

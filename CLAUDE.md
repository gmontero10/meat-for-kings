# Meat for Kings

Gas grill product catalog web app. 802 products scraped from BBQGuys.com.

## Quick Start

```bash
cd ~/Meat\ for\ Kings
python3 app.py          # http://localhost:8000
```

## Architecture

**Stack:** Flask + SQLite + vanilla JS (no build step, no framework).

| File | Role |
|------|------|
| `app.py` | Flask server, 4 routes (1 HTML + 3 JSON API) |
| `templates/index.html` | Jinja2 shell — header, sidebar, grid, modal |
| `static/js/app.js` | IIFE-wrapped SPA — state, API calls, rendering, events |
| `static/css/style.css` | Full design system with CSS custom properties |
| `catalog.db` | SQLite, single `products` table, read-only at runtime |
| `scrape.py` | Playwright scraper (standalone, do not modify) |

## Database

Single `products` table. Prices are **integers in cents** (e.g. 49999 = $499.99). `bullet_points` is a JSON-encoded string array. `product_url` is relative (needs `https://www.bbqguys.com` prefix). `id` is TEXT not INTEGER.

**NULL prevalence:** 72.7% have NULL `fuel_type` and `stock_status`. 85% have NULL `rating`. 73% have NULL `description`. Handle NULLs gracefully everywhere.

Six indexes exist: `idx_brand`, `idx_price`, `idx_fuel`, `idx_stock`, `idx_rating`, `idx_name`.

## API Endpoints

- `GET /` — serves index.html
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

**Add a new filter:** Add param handling in `api_products()` → add UI element in `index.html` → bind change event in `bindEvents()` → add to `state.filters` + `buildParams()` + `updateFilterTags()` + `removeFilter()` + `clearAllFilters()`.

**Add a new sort option:** Add to `sort_map` in `app.py` → add `<option>` in `index.html`.

**Change card layout:** Edit `productCard()` in `app.js` + `.product-card` styles in `style.css`.

**Change modal content:** Edit `renderModal()` in `app.js` + `.modal-*` styles in `style.css`.

## Do Not

- Modify `scrape.py` or `catalog.db` directly
- Add a build step or framework — this is intentionally vanilla
- Remove the `escapeHtml()` / `sanitizeHtml()` calls (XSS protection)
- Use port 5000 (blocked by macOS AirPlay Receiver)

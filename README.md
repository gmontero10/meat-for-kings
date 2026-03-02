# Meat for Kings

A professional web catalog for browsing **802 gas grill products** scraped from BBQGuys.com. Warm luxury design, fast filtering, infinite scroll, and detailed product modals.

**Live:** https://meat-for-kings.onrender.com/

![Stack](https://img.shields.io/badge/Flask-SQLite-blue) ![Products](https://img.shields.io/badge/Products-802-gold) ![Brands](https://img.shields.io/badge/Brands-54-green)

## Features

- **Filterable catalog** — filter by brand (54), fuel type (5), price range, in-stock status, and rating
- **Full-text search** with debounced input and request cancellation
- **Infinite scroll** — loads 36 products at a time via IntersectionObserver
- **Product detail modals** — full descriptions, bullet points, specs, and direct links to BBQGuys
- **Responsive design** — 4-column → 1-column grid, mobile slide-out filter panel
- **Lazy image loading** — images load as cards scroll into view
- **Skeleton loading states** — animated placeholders during data fetches
- **No build step** — vanilla HTML/CSS/JS, zero dependencies beyond Flask

## Quick Start

```bash
# 1. Install dependencies
cd ~/Meat\ for\ Kings
pip3 install -r requirements.txt

# 2. Start the server
python3 app.py

# 3. Open in browser
open http://localhost:8000
```

The server creates SQLite indexes on first run for fast queries.

## Deployment

Hosted on [Render](https://render.com) (free tier). Every push to `main` triggers an automatic redeploy via Render's GitHub integration.

| Detail | Value |
|--------|-------|
| Platform | Render (free web service) |
| Server | gunicorn |
| Config | `render.yaml` (Render Blueprint) |
| Auto-deploy | Yes — on push to `main` |

## Project Structure

```
Meat for Kings/
├── app.py                  # Flask server + JSON API (218 lines)
├── catalog.db              # SQLite database (802 products, ~1.3 MB)
├── scrape.py               # Playwright scraper (standalone)
├── render.yaml             # Render deployment config
├── requirements.txt        # flask, gunicorn
├── CLAUDE.md               # Claude Code context file
├── static/
│   ├── css/style.css       # Design system (1447 lines)
│   └── js/app.js           # SPA frontend (850 lines)
└── templates/
    └── index.html          # Page shell (179 lines)
```

## API Reference

### `GET /api/filters`

Returns available filter options. Called once on page load.

```json
{
  "brands": ["Blaze", "Napoleon", "Weber Grills", "..."],
  "fuel_types": ["Charcoal", "Electric", "Natural Gas", "Pellets", "Propane"],
  "price_min": 8900,
  "price_max": 5657500,
  "total": 802
}
```

### `GET /api/products`

Paginated product list with filtering and sorting.

| Param | Type | Default | Description |
|-------|------|---------|-------------|
| `page` | int | 1 | Page number |
| `per_page` | int | 36 | Results per page (max 100) |
| `sort` | string | `price_asc` | `price_asc`, `price_desc`, `name_asc`, `rating_desc`, `savings_desc` |
| `search` | string | — | Searches name and brand |
| `brand` | string | — | Comma-separated brand names |
| `fuel_type` | string | — | Comma-separated fuel types |
| `min_price` | int | — | Minimum price in cents |
| `max_price` | int | — | Maximum price in cents |
| `in_stock` | string | — | `1` or `true` for in-stock only |
| `has_rating` | string | — | `1` or `true` for rated products only |

```json
{
  "products": [{ "id": "3105425", "name": "...", "brand": "...", "price_current": 236000, "..." }],
  "total": 802,
  "page": 1,
  "per_page": 36,
  "total_pages": 23
}
```

### `GET /api/products/<id>`

Full product detail including parsed bullet points.

## Design System

**Fonts:** Playfair Display (headings) + Inter (body) via Google Fonts

**Color palette:**

| Token | Hex | Usage |
|-------|-----|-------|
| Gold accent | `#C8963E` | Buttons, links, brand text, focus rings |
| Header | `#1A1814` | Dark warm header background |
| Page bg | `#FAFAF8` | Warm off-white |
| Sale red | `#C0392B` | Savings badges |
| Stock green | `#2D8F4E` | In-stock indicators |
| Star gold | `#E8A83E` | Star ratings |

**Responsive breakpoints:** 1400px (4-col), 1024px (3-col), 768px (2-col + mobile sidebar), 480px (1-col)

## Data Notes

- **Prices are stored in cents** (integer). $499.99 = `49999`.
- **72.7% of products** have NULL `fuel_type` and `stock_status` (not enriched by the scraper's secondary data sources).
- **85% lack ratings** — the UI hides stars entirely rather than showing 0.
- **Product URLs are relative** — the app prepends `https://www.bbqguys.com`.
- **Descriptions contain HTML** — sanitized with a tag allowlist before rendering.
- **`bullet_points`** is stored as a JSON string in SQLite, parsed to an array by the API.

## Tech Decisions

| Decision | Rationale |
|----------|-----------|
| No framework | 802 products doesn't need React. Vanilla JS keeps it fast and dependency-free. |
| Prices in cents | Avoids floating-point rounding. Standard practice for currency. |
| Port 8000 | macOS AirPlay Receiver blocks port 5000. |
| IntersectionObserver | Native API for both infinite scroll and lazy images. No scroll event listeners. |
| AbortController | Cancels stale search requests to prevent race conditions. |
| DOMParser sanitizer | Safer than regex for HTML sanitization. Allowlist approach. |

## License

Personal project. Product data and images belong to BBQGuys.com.

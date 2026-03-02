#!/usr/bin/env python3
"""
Meat for Kings — BBQGuys Pellet Grill Scraper
Scrapes all pellet grill products from BBQGuys.com into an SQLite database.
Uses Playwright non-headless to bypass Akamai bot protection.

Strategy:
- Navigate to each page via URL (?page=N) for a fresh load
- Extract products from DOM (.product-card elements) — this updates correctly per page
- Supplement with Apollo state data (rich details) where available
- Intercept GraphQL responses for additional structured data
"""

import json
import re
import sqlite3
import time
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

BASE_URL = "https://www.bbqguys.com/d/9953/cooking/grills/pellet"
DB_PATH = "catalog.db"
MAX_RETRIES = 2
PAGE_SETTLE_SECONDS = 5
MAX_PAGES = 25


def create_database():
    conn = sqlite3.connect(DB_PATH)
    conn.execute("""
        CREATE TABLE IF NOT EXISTS products (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            brand TEXT,
            category TEXT,
            model_number TEXT,
            fuel_type TEXT,
            price_current INTEGER,
            price_retail INTEGER,
            price_sale INTEGER,
            price_formatted TEXT,
            retail_formatted TEXT,
            savings_formatted TEXT,
            savings_percent TEXT,
            image_url TEXT,
            product_url TEXT,
            rating REAL,
            review_count INTEGER,
            description TEXT,
            bullet_points TEXT,
            stock_status TEXT,
            ships_in TEXT,
            is_free_shipping INTEGER,
            video_url TEXT,
            scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
    """)
    conn.commit()
    return conn


def dollars_to_cents(value):
    if value is None:
        return None
    try:
        return int(round(float(value) * 100))
    except (ValueError, TypeError):
        return None


def parse_price_text(text):
    """Parse a price string like '$1,234.56' into cents."""
    if not text:
        return None
    match = re.search(r'\$[\d,]+\.?\d*', text)
    if match:
        price_str = match.group().replace('$', '').replace(',', '')
        try:
            return int(round(float(price_str) * 100))
        except ValueError:
            return None
    return None


def extract_from_apollo(apollo_state):
    """Extract product items from Apollo state (works best on page 1)."""
    products = {}
    if not apollo_state or not isinstance(apollo_state, dict):
        return products

    for key, value in apollo_state.items():
        if not isinstance(value, dict) or value.get("__typename") != "Item":
            continue

        product_id = str(value.get("id", ""))
        if not product_id:
            continue

        # Resolve pricing
        pricing = value.get("pricing") or {}
        if isinstance(pricing, dict) and "__ref" in pricing:
            pricing = apollo_state.get(pricing["__ref"], {})

        pricing_formatted = value.get("pricingFormatted") or {}
        if isinstance(pricing_formatted, dict) and "__ref" in pricing_formatted:
            pricing_formatted = apollo_state.get(pricing_formatted["__ref"], {})

        bullet_points = value.get("bulletPoints")
        if isinstance(bullet_points, list):
            resolved = []
            for bp in bullet_points:
                if isinstance(bp, dict) and "__ref" in bp:
                    ref_obj = apollo_state.get(bp["__ref"], {})
                    resolved.append(ref_obj.get("text", str(ref_obj)))
                elif isinstance(bp, str):
                    resolved.append(bp)
                else:
                    resolved.append(str(bp))
            bullet_points = json.dumps(resolved)
        elif bullet_points is not None:
            bullet_points = json.dumps([str(bullet_points)])

        products[product_id] = {
            "id": product_id,
            "name": value.get("name"),
            "brand": value.get("manufacturerName"),
            "category": value.get("category"),
            "model_number": value.get("modelNumber"),
            "fuel_type": value.get("fuelType"),
            "price_current": dollars_to_cents(pricing.get("current")),
            "price_retail": dollars_to_cents(pricing.get("retail")),
            "price_sale": dollars_to_cents(pricing.get("sale")),
            "price_formatted": pricing_formatted.get("current"),
            "retail_formatted": pricing_formatted.get("retail"),
            "savings_formatted": pricing_formatted.get("savings"),
            "savings_percent": pricing_formatted.get("savingsPercent") or pricing_formatted.get("percent"),
            "image_url": value.get("imageUrl"),
            "product_url": value.get("url"),
            "rating": value.get("userReviewsRating"),
            "review_count": value.get("userReviewsCount"),
            "description": value.get("description"),
            "bullet_points": bullet_points,
            "stock_status": value.get("stockStatus"),
            "ships_in": value.get("shipsIn"),
            "is_free_shipping": 1 if value.get("isFreeShipping") else 0,
            "video_url": value.get("videoUrl"),
        }

    return products


def extract_from_graphql(graphql_items):
    """Extract products from intercepted GraphQL response items."""
    products = {}
    for item in graphql_items:
        if not isinstance(item, dict):
            continue
        product_id = str(item.get("id", ""))
        if not product_id:
            continue

        pricing = item.get("pricing") or {}
        pricing_formatted = item.get("pricingFormatted") or {}

        bullet_points = item.get("bulletPoints")
        if isinstance(bullet_points, list):
            texts = []
            for bp in bullet_points:
                if isinstance(bp, dict):
                    texts.append(bp.get("text", str(bp)))
                elif isinstance(bp, str):
                    texts.append(bp)
            bullet_points = json.dumps(texts)

        products[product_id] = {
            "id": product_id,
            "name": item.get("name"),
            "brand": item.get("manufacturerName"),
            "category": item.get("category"),
            "model_number": item.get("modelNumber"),
            "fuel_type": item.get("fuelType"),
            "price_current": dollars_to_cents(pricing.get("current")),
            "price_retail": dollars_to_cents(pricing.get("retail")),
            "price_sale": dollars_to_cents(pricing.get("sale")),
            "price_formatted": pricing_formatted.get("current"),
            "retail_formatted": pricing_formatted.get("retail"),
            "savings_formatted": pricing_formatted.get("savings"),
            "savings_percent": pricing_formatted.get("savingsPercent") or pricing_formatted.get("percent"),
            "image_url": item.get("imageUrl"),
            "product_url": item.get("url"),
            "rating": item.get("userReviewsRating"),
            "review_count": item.get("userReviewsCount"),
            "description": item.get("description"),
            "bullet_points": bullet_points,
            "stock_status": item.get("stockStatus"),
            "ships_in": item.get("shipsIn"),
            "is_free_shipping": 1 if item.get("isFreeShipping") else 0,
            "video_url": item.get("videoUrl"),
        }

    return products


def extract_from_dom(page):
    """Extract product data from DOM .product-card elements."""
    return page.evaluate("""() => {
        const cards = document.querySelectorAll('.product-card');
        const products = [];
        for (const card of cards) {
            // Get product link
            const link = card.querySelector('a[href*="/i/"]');
            if (!link) continue;

            const href = link.getAttribute('href') || '';
            // Extract ID from URL: /i/{id}/{brand}/{slug}
            const idMatch = href.match(/\\/i\\/(\\d+)\\//);
            if (!idMatch) continue;

            const id = idMatch[1];
            const name = link.textContent.trim();

            // Extract brand from URL path: /i/{id}/{brand}/{slug}
            const brandMatch = href.match(/\\/i\\/\\d+\\/([^\\/]+)\\//);
            const brandRaw = brandMatch ? brandMatch[1].replace(/-/g, ' ') : null;
            // Title-case the brand name
            const brand = brandRaw ? brandRaw.replace(/\\b\\w/g, c => c.toUpperCase()) : null;

            // Extract image
            const img = card.querySelector('img');
            const imageUrl = img ? (img.getAttribute('src') || img.getAttribute('data-src')) : null;

            // Extract price — get only the first (current) price
            let priceText = null;
            const allText = card.textContent;
            const priceMatches = allText.match(/\\$[\\d,]+\\.\\d{2}/g);
            if (priceMatches && priceMatches.length > 0) {
                priceText = priceMatches[0];  // First price is current/sale price
            }

            // Extract rating - look for star rating (value between 0-5)
            let rating = null;
            // Try aria-label on star elements first
            const starEls = card.querySelectorAll('[aria-label]');
            for (const el of starEls) {
                const label = el.getAttribute('aria-label') || '';
                const starMatch = label.match(/([\d.]+)\s*(?:out of|\/)\s*5|rating[:\s]*([\d.]+)/i);
                if (starMatch) {
                    rating = parseFloat(starMatch[1] || starMatch[2]);
                    if (rating >= 0 && rating <= 5) break;
                    rating = null;
                }
            }
            // Fallback: look for rating in text that looks like X.X pattern near stars
            if (rating === null) {
                const allText = card.textContent;
                const rMatch = allText.match(/(\d\.\d)\s*(?:stars?|out of)/i);
                if (rMatch) rating = parseFloat(rMatch[1]);
            }

            // Extract review count
            const reviewEl = card.querySelector('a[href*="#reviews"]');
            let reviewCount = null;
            if (reviewEl) {
                const countMatch = reviewEl.textContent.match(/(\\d+)/);
                if (countMatch) reviewCount = parseInt(countMatch[1]);
            }

            // Free shipping badge
            const freeShipping = card.textContent.toLowerCase().includes('free shipping') ? 1 : 0;

            products.push({
                id: id,
                name: name,
                brand: brand,
                product_url: href,
                image_url: imageUrl,
                price_formatted: priceText,
                rating: rating,
                review_count: reviewCount,
                is_free_shipping: freeShipping,
            });
        }
        return products;
    }""")


def merge_product(existing, new_data):
    """Merge new_data into existing product, preferring non-None values."""
    merged = dict(existing)
    for key, value in new_data.items():
        if value is not None and (merged.get(key) is None):
            merged[key] = value
    return merged


def save_products(conn, products):
    cursor = conn.cursor()
    for p in products.values():
        cursor.execute("""
            INSERT OR REPLACE INTO products (
                id, name, brand, category, model_number, fuel_type,
                price_current, price_retail, price_sale,
                price_formatted, retail_formatted, savings_formatted, savings_percent,
                image_url, product_url, rating, review_count,
                description, bullet_points, stock_status, ships_in,
                is_free_shipping, video_url
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            p.get("id"), p.get("name"), p.get("brand"), p.get("category"),
            p.get("model_number"), p.get("fuel_type"),
            p.get("price_current"), p.get("price_retail"), p.get("price_sale"),
            p.get("price_formatted"), p.get("retail_formatted"),
            p.get("savings_formatted"), p.get("savings_percent"),
            p.get("image_url"), p.get("product_url"),
            p.get("rating"), p.get("review_count"),
            p.get("description"), p.get("bullet_points"),
            p.get("stock_status"), p.get("ships_in"),
            p.get("is_free_shipping"), p.get("video_url"),
        ))
    conn.commit()


def print_summary(conn):
    cursor = conn.cursor()
    total = cursor.execute("SELECT COUNT(*) FROM products").fetchone()[0]
    print(f"\n{'=' * 60}")
    print(f"  SCRAPE COMPLETE — {total} products saved to {DB_PATH}")
    print(f"{'=' * 60}")

    print("\nTop 10 Brands:")
    rows = cursor.execute(
        "SELECT brand, COUNT(*) as cnt FROM products GROUP BY brand ORDER BY cnt DESC LIMIT 10"
    ).fetchall()
    for brand, count in rows:
        print(f"  {brand or 'Unknown':<35} {count:>4} products")

    print("\nPrice Range:")
    row = cursor.execute(
        "SELECT MIN(price_current), MAX(price_current) FROM products WHERE price_current IS NOT NULL"
    ).fetchone()
    if row and row[0] is not None:
        print(f"  Low:  ${row[0] / 100:,.2f}")
        print(f"  High: ${row[1] / 100:,.2f}")

    print("\nSample Products:")
    rows = cursor.execute(
        "SELECT name, price_formatted, rating FROM products ORDER BY RANDOM() LIMIT 5"
    ).fetchall()
    for name, price, rating in rows:
        rating_str = f"{rating:.1f}" if rating else "N/A"
        print(f"  {(name or '')[:50]:<52} {price or 'N/A':<14} Rating: {rating_str}")

    # Count with various data fields
    filled = cursor.execute("""
        SELECT
            COUNT(CASE WHEN price_current IS NOT NULL THEN 1 END) as has_price,
            COUNT(CASE WHEN image_url IS NOT NULL THEN 1 END) as has_image,
            COUNT(CASE WHEN rating IS NOT NULL THEN 1 END) as has_rating,
            COUNT(CASE WHEN description IS NOT NULL THEN 1 END) as has_description
        FROM products
    """).fetchone()
    print(f"\nData completeness ({total} total):")
    print(f"  With price:       {filled[0]:>4}")
    print(f"  With image:       {filled[1]:>4}")
    print(f"  With rating:      {filled[2]:>4}")
    print(f"  With description: {filled[3]:>4}")
    print()


def main():
    print("Meat for Kings — BBQGuys Pellet Grill Scraper")
    print("=" * 60)

    conn = create_database()
    all_products = {}

    with sync_playwright() as pw:
        browser = pw.chromium.launch(
            headless=False,
            args=["--disable-blink-features=AutomationControlled"],
        )
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            user_agent="Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        )

        page = context.new_page()
        page.add_init_script("""
            Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
        """)

        # Intercept GraphQL responses for rich product data
        graphql_items = []

        def handle_response(response):
            if "graphql.bbqguys.com" not in response.url:
                return
            try:
                body = response.json()
                # Recursively find lists of items in the response
                find_items(body, graphql_items)
            except Exception:
                pass

        def find_items(obj, items_list):
            """Recursively find Item objects in GraphQL response."""
            if isinstance(obj, dict):
                if obj.get("__typename") == "Item" and obj.get("id"):
                    items_list.append(obj)
                for v in obj.values():
                    find_items(v, items_list)
            elif isinstance(obj, list):
                for v in obj:
                    find_items(v, items_list)

        page.on("response", handle_response)

        consecutive_no_new = 0

        for page_num in range(1, MAX_PAGES + 1):
            url = BASE_URL if page_num == 1 else f"{BASE_URL}?page={page_num}"

            print(f"\nPage {page_num}:")

            # Clear GraphQL items for this page
            graphql_items.clear()

            # Navigate with retry
            for attempt in range(MAX_RETRIES + 1):
                try:
                    page.goto(url, wait_until="domcontentloaded", timeout=60000)
                    time.sleep(PAGE_SETTLE_SECONDS)
                    break
                except PlaywrightTimeout:
                    if attempt < MAX_RETRIES:
                        print(f"  Timeout, retry {attempt + 1}...")
                        time.sleep(3)
                    else:
                        print(f"  Failed after {MAX_RETRIES + 1} attempts, skipping page")
                        continue

            # 1. Extract from Apollo state (best data on page 1)
            apollo_products = {}
            try:
                apollo_state = page.evaluate("() => window.__APOLLO_STATE__")
                apollo_products = extract_from_apollo(apollo_state)
            except Exception as e:
                print(f"  Apollo state extraction error: {e}")

            # 2. Extract from intercepted GraphQL responses
            gql_products = extract_from_graphql(graphql_items)

            # 3. Extract from DOM (most reliable for getting all products on the page)
            dom_items = []
            try:
                dom_items = extract_from_dom(page)
            except Exception as e:
                print(f"  DOM extraction error: {e}")

            # Merge all sources: DOM items form the base, enriched by Apollo/GraphQL
            new_count = 0
            for dom_item in dom_items:
                pid = dom_item["id"]

                # Start with DOM data
                product = {
                    "id": pid,
                    "name": dom_item.get("name"),
                    "brand": dom_item.get("brand"),
                    "category": "Pellet Grills",
                    "model_number": None,
                    "fuel_type": None,
                    "price_current": parse_price_text(dom_item.get("price_formatted")),
                    "price_retail": None,
                    "price_sale": None,
                    "price_formatted": dom_item.get("price_formatted"),
                    "retail_formatted": None,
                    "savings_formatted": None,
                    "savings_percent": None,
                    "image_url": dom_item.get("image_url"),
                    "product_url": dom_item.get("product_url"),
                    "rating": dom_item.get("rating"),
                    "review_count": dom_item.get("review_count"),
                    "description": None,
                    "bullet_points": None,
                    "stock_status": None,
                    "ships_in": None,
                    "is_free_shipping": dom_item.get("is_free_shipping"),
                    "video_url": None,
                }

                # Enrich from Apollo state
                if pid in apollo_products:
                    product = merge_product(product, apollo_products[pid])
                    # Let Apollo's category override the hardcoded fallback
                    if apollo_products[pid].get("category"):
                        product["category"] = apollo_products[pid]["category"]

                # Enrich from GraphQL
                if pid in gql_products:
                    product = merge_product(product, gql_products[pid])
                    # Let GraphQL's category override the hardcoded fallback
                    if gql_products[pid].get("category"):
                        product["category"] = gql_products[pid]["category"]

                if pid not in all_products:
                    new_count += 1
                all_products[pid] = merge_product(all_products.get(pid, {}), product)

            # Also add any Apollo/GraphQL items not found in DOM
            for source in [apollo_products, gql_products]:
                for pid, pdata in source.items():
                    if pid not in all_products:
                        new_count += 1
                        all_products[pid] = pdata
                    else:
                        all_products[pid] = merge_product(all_products[pid], pdata)

            print(f"  DOM: {len(dom_items)} | Apollo: {len(apollo_products)} | GraphQL: {len(gql_products)}")
            print(f"  New: {new_count} | Total unique: {len(all_products)}")

            # Stop conditions
            if new_count == 0 and len(dom_items) == 0:
                print("\n  No products found — stopping.")
                break

            if new_count == 0:
                consecutive_no_new += 1
                if consecutive_no_new >= 3:
                    print(f"\n  No new products for {consecutive_no_new} pages — stopping.")
                    break
            else:
                consecutive_no_new = 0

        browser.close()

    print(f"\nTotal unique products collected: {len(all_products)}")
    print("Saving to database...")
    save_products(conn, all_products)
    print_summary(conn)
    conn.close()


if __name__ == "__main__":
    main()

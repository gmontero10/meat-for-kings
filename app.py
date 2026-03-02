"""Meat for Kings — Flask backend serving the gas grill catalog."""

import json
import sqlite3
from pathlib import Path

from flask import Flask, g, jsonify, render_template, request

app = Flask(__name__)
DB_PATH = Path(__file__).parent / "catalog-es.db"


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

def get_db():
    """Return a per-request database connection stored on flask.g."""
    if "db" not in g:
        g.db = sqlite3.connect(str(DB_PATH))
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close_db(exc):
    db = g.pop("db", None)
    if db is not None:
        db.close()


def ensure_indexes():
    """Create useful indexes if they don't already exist."""
    db = sqlite3.connect(str(DB_PATH))
    indexes = [
        "CREATE INDEX IF NOT EXISTS idx_brand ON products(brand)",
        "CREATE INDEX IF NOT EXISTS idx_price ON products(price_current)",
        "CREATE INDEX IF NOT EXISTS idx_fuel ON products(fuel_type)",
        "CREATE INDEX IF NOT EXISTS idx_stock ON products(stock_status)",
        "CREATE INDEX IF NOT EXISTS idx_rating ON products(rating)",
        "CREATE INDEX IF NOT EXISTS idx_name ON products(name)",
        "CREATE INDEX IF NOT EXISTS idx_category ON products(category)",
    ]
    for stmt in indexes:
        db.execute(stmt)
    db.commit()
    db.close()


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/filters")
def api_filters():
    db = get_db()

    brands = [
        r[0]
        for r in db.execute(
            "SELECT DISTINCT brand FROM products WHERE brand IS NOT NULL ORDER BY brand"
        ).fetchall()
    ]

    fuel_types = [
        r[0]
        for r in db.execute(
            "SELECT DISTINCT fuel_type FROM products WHERE fuel_type IS NOT NULL ORDER BY fuel_type"
        ).fetchall()
    ]

    categories = [
        r[0]
        for r in db.execute(
            "SELECT DISTINCT category FROM products WHERE category IS NOT NULL ORDER BY category"
        ).fetchall()
    ]

    row = db.execute(
        "SELECT MIN(price_current) AS min_price, MAX(price_current) AS max_price, COUNT(*) AS total "
        "FROM products"
    ).fetchone()

    return jsonify(
        {
            "brands": brands,
            "fuel_types": fuel_types,
            "categories": categories,
            "price_min": row["min_price"],
            "price_max": row["max_price"],
            "total": row["total"],
        }
    )


@app.route("/api/products")
def api_products():
    db = get_db()

    # --- pagination & sort params ---
    page = max(1, request.args.get("page", 1, type=int))
    per_page = min(100, max(1, request.args.get("per_page", 36, type=int)))
    sort = request.args.get("sort", "price_asc")

    # --- filters ---
    search = request.args.get("search", "").strip()
    brand_param = request.args.get("brand", "").strip()
    fuel_param = request.args.get("fuel_type", "").strip()
    category_param = request.args.get("category", "").strip()
    min_price = request.args.get("min_price", type=int)
    max_price = request.args.get("max_price", type=int)
    in_stock = request.args.get("in_stock", "").lower() in ("1", "true")
    has_rating = request.args.get("has_rating", "").lower() in ("1", "true")

    where_clauses = []
    params = []

    if search:
        where_clauses.append("(name LIKE ? OR brand LIKE ?)")
        params += [f"%{search}%", f"%{search}%"]

    if brand_param:
        brands = [b.strip() for b in brand_param.split(",") if b.strip()]
        if brands:
            placeholders = ",".join("?" for _ in brands)
            where_clauses.append(f"brand IN ({placeholders})")
            params += brands

    if fuel_param:
        fuels = [f.strip() for f in fuel_param.split(",") if f.strip()]
        if fuels:
            placeholders = ",".join("?" for _ in fuels)
            where_clauses.append(f"fuel_type IN ({placeholders})")
            params += fuels

    if category_param:
        cats = [c.strip() for c in category_param.split(",") if c.strip()]
        if cats:
            placeholders = ",".join("?" for _ in cats)
            where_clauses.append(f"category IN ({placeholders})")
            params += cats

    if min_price is not None:
        where_clauses.append("price_current >= ?")
        params.append(min_price)

    if max_price is not None:
        where_clauses.append("price_current <= ?")
        params.append(max_price)

    if in_stock:
        where_clauses.append("stock_status = 'IN_STOCK'")

    if has_rating:
        where_clauses.append("rating IS NOT NULL")

    where_sql = (" WHERE " + " AND ".join(where_clauses)) if where_clauses else ""

    # --- sort ---
    sort_map = {
        "price_asc": "price_current ASC",
        "price_desc": "price_current DESC",
        "name_asc": "name ASC",
        "rating_desc": "CASE WHEN rating IS NULL THEN 1 ELSE 0 END, rating DESC",
        "savings_desc": "CAST(REPLACE(REPLACE(savings_percent, '%', ''), '', '0') AS INTEGER) DESC",
    }
    order_sql = sort_map.get(sort, "price_current ASC")

    # --- count ---
    count_row = db.execute(
        f"SELECT COUNT(*) AS cnt FROM products{where_sql}", params
    ).fetchone()
    total = count_row["cnt"]

    # --- fetch page ---
    offset = (page - 1) * per_page
    card_fields = (
        "id, name, brand, fuel_type, price_current, price_retail, price_sale, "
        "price_formatted, retail_formatted, savings_formatted, savings_percent, "
        "image_url, rating, review_count, stock_status, is_free_shipping"
    )
    rows = db.execute(
        f"SELECT {card_fields} FROM products{where_sql} ORDER BY {order_sql} LIMIT ? OFFSET ?",
        params + [per_page, offset],
    ).fetchall()

    products = [dict(r) for r in rows]

    return jsonify(
        {
            "products": products,
            "total": total,
            "page": page,
            "per_page": per_page,
            "total_pages": max(1, -(-total // per_page)),  # ceiling division
        }
    )


@app.route("/api/products/<product_id>")
def api_product_detail(product_id):
    db = get_db()
    row = db.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    if row is None:
        return jsonify({"error": "Product not found"}), 404

    product = dict(row)

    # Parse bullet_points JSON string into a list
    bp = product.get("bullet_points")
    if bp:
        try:
            product["bullet_points"] = json.loads(bp)
        except (json.JSONDecodeError, TypeError):
            product["bullet_points"] = []
    else:
        product["bullet_points"] = []

    return jsonify(product)


# ---------------------------------------------------------------------------
# Startup
# ---------------------------------------------------------------------------

if __name__ == "__main__":
    ensure_indexes()
    app.run(debug=True, host="0.0.0.0", port=8000)

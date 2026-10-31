#!/usr/bin/env python3
"""Loopback-only SQLite API for the ORBIT local workspace."""

from __future__ import annotations

import hashlib
import json
import os
import secrets
import sqlite3
import uuid
from datetime import date, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

ROOT = Path(__file__).resolve().parent
DB_PATH = Path(os.environ.get("ORBIT_DB_PATH", ROOT / "orbit.sqlite3"))
SCHEMA = ROOT / "schema.sql"
SEED = ROOT / "seed.sql"
PORT = int(os.environ.get("ORBIT_API_PORT", "8000"))
TABLES = {
    "profiles", "customers", "staff", "products", "product_variants",
    "subscription_plans", "quotation_templates", "quotations", "quotation_lines",
    "subscriptions", "subscription_lines", "tax_rules", "discount_rules",
    "invoices", "invoice_lines", "payments", "payment_allocations", "billing_runs",
}


def connect() -> sqlite3.Connection:
    db = sqlite3.connect(DB_PATH, timeout=10)
    db.row_factory = sqlite3.Row
    db.execute("PRAGMA foreign_keys = ON")
    return db


def initialize() -> None:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    with connect() as db:
        db.executescript(SCHEMA.read_text(encoding="utf-8"))
        db.executescript(SEED.read_text(encoding="utf-8"))


def new_id() -> str:
    return str(uuid.uuid4())


def today() -> str:
    return date.today().isoformat()


def record(row: sqlite3.Row | None) -> dict | None:
    return dict(row) if row else None


def next_number(db: sqlite3.Connection, prefix: str, table: str) -> str:
    year = date.today().year
    reference_column = "reference" if table == "payments" else "number"
    count = db.execute(
        f'SELECT COUNT(*) AS n FROM "{table}" WHERE "{reference_column}" LIKE ?',
        (f"{prefix}-{year}-%",),
    ).fetchone()["n"] + 1
    return f"{prefix}-{year}-{count:06d}"


class ApiError(Exception):
    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.status = status


class Handler(BaseHTTPRequestHandler):
    server_version = "OrbitLocal/1.0"

    def log_message(self, fmt: str, *args: object) -> None:
        print(f"{self.address_string()} - {fmt % args}")

    def send_json(self, payload: object, status: int = 200) -> None:
        encoded = json.dumps(payload, default=str).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        origin = self.headers.get("Origin", "")
        host = urlparse(origin).hostname if origin else ""
        if host in {"localhost", "127.0.0.1", "::1"}:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.end_headers()
        self.wfile.write(encoded)

    def read_json(self) -> dict:
        length = int(self.headers.get("Content-Length", "0"))
        if length > 1_000_000:
            raise ApiError("Request body is too large.", 413)
        try:
            value = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError as exc:
            raise ApiError("Request body must be valid JSON.") from exc
        if not isinstance(value, dict):
            raise ApiError("Expected a JSON object.")
        return value

    def current_user(self, db: sqlite3.Connection) -> dict:
        authorization = self.headers.get("Authorization", "")
        token = authorization.removeprefix("Bearer ").strip()
        user = db.execute(
            """SELECT u.id, u.email, p.full_name, p.role
               FROM sessions s JOIN users u ON u.id=s.user_id
               JOIN profiles p ON p.id=u.id WHERE s.token=?""", (token,)
        ).fetchone()
        if not user:
            raise ApiError("Sign in to your local workspace first.", 401)
        return dict(user)

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        origin = self.headers.get("Origin", "")
        host = urlparse(origin).hostname if origin else ""
        if host in {"localhost", "127.0.0.1", "::1"}:
            self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Headers", "Authorization, Content-Type")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.end_headers()

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        try:
            with connect() as db:
                user = self.current_user(db)
                if parsed.path == "/api/auth/session":
                    self.send_json({"user": user})
                    return
                if parsed.path == "/api/rpc/dashboard_summary":
                    months = max(1, min(int(params.get("p_months", ["6"])[0]), 24))
                    self.send_json(dashboard_summary(db, months))
                    return
                table = parsed.path.removeprefix("/api/data/")
                if table not in TABLES:
                    raise ApiError("Unknown table.", 404)
                self.send_json(query_table(db, table, params))
        except ApiError as exc:
            self.send_json({"message": str(exc)}, exc.status)
        except (ValueError, sqlite3.Error) as exc:
            self.send_json({"message": str(exc)}, 400)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        try:
            body = self.read_json()
            with connect() as db:
                if parsed.path == "/api/auth/login":
                    self.send_json(login(db, body))
                    return
                if parsed.path == "/api/auth/register":
                    self.send_json(register(db, body), 201)
                    return
                user = self.current_user(db)
                if parsed.path == "/api/auth/logout":
                    token = self.headers.get("Authorization", "").removeprefix("Bearer ").strip()
                    db.execute("DELETE FROM sessions WHERE token=?", (token,))
                    self.send_json({"ok": True})
                    return
                if parsed.path == "/api/auth/password":
                    password = str(body.get("password", ""))
                    if len(password) < 1:
                        raise ApiError("Password cannot be empty.")
                    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), user["id"].encode(), 120_000).hex()
                    db.execute("UPDATE users SET password_hash=? WHERE id=?", (digest, user["id"]))
                    self.send_json({"ok": True})
                    return
                if parsed.path.startswith("/api/functions/"):
                    self.send_json(run_function(db, parsed.path.rsplit("/", 1)[-1], body, user))
                    return
                table = parsed.path.removeprefix("/api/data/")
                if table not in TABLES:
                    raise ApiError("Unknown table.", 404)
                rows = body.get("records", [body])
                if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
                    raise ApiError("Invalid record data.")
                created = [insert_record(db, table, row, user) for row in rows]
                self.send_json(created if len(created) != 1 else created[0], 201)
        except ApiError as exc:
            self.send_json({"message": str(exc)}, exc.status)
        except (ValueError, sqlite3.Error) as exc:
            self.send_json({"message": str(exc)}, 400)

    def do_PATCH(self) -> None:
        try:
            with connect() as db:
                user = self.current_user(db)
                table, params = self.resource()
                if table not in TABLES:
                    raise ApiError("Unknown table.", 404)
                values = self.read_json()
                self.send_json(update_records(db, table, values, params, user))
        except ApiError as exc:
            self.send_json({"message": str(exc)}, exc.status)
        except sqlite3.Error as exc:
            self.send_json({"message": str(exc)}, 400)

    def do_DELETE(self) -> None:
        try:
            with connect() as db:
                self.current_user(db)
                table, params = self.resource()
                if table not in TABLES:
                    raise ApiError("Unknown table.", 404)
                where, args = where_clause(params)
                db.execute(f'DELETE FROM "{table}" {where}', args)
                self.send_json({"ok": True})
        except ApiError as exc:
            self.send_json({"message": str(exc)}, exc.status)
        except sqlite3.Error as exc:
            self.send_json({"message": str(exc)}, 400)

    def resource(self) -> tuple[str, dict[str, list[str]]]:
        parsed = urlparse(self.path)
        return parsed.path.removeprefix("/api/data/"), parse_qs(parsed.query)


def login(db: sqlite3.Connection, body: dict) -> dict:
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    if not email or not password:
        raise ApiError("Enter your email and any non-empty password.")
    user = db.execute(
        """SELECT u.id, u.email, p.full_name, p.role FROM users u
           JOIN profiles p ON p.id=u.id WHERE lower(u.email)=lower(?)""", (email,)
    ).fetchone()
    if not user:
        raise ApiError("Local account not found. Use demo@orbit.local.", 401)
    if user["email"].lower() != "demo@orbit.local":
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), user["id"].encode(), 120_000).hex()
        saved = db.execute("SELECT password_hash FROM users WHERE id=?", (user["id"],)).fetchone()["password_hash"]
        if not secrets.compare_digest(digest, saved):
            raise ApiError("Incorrect email or password.", 401)
    token = secrets.token_urlsafe(36)
    db.execute("INSERT INTO sessions(token,user_id) VALUES(?,?)", (token, user["id"]))
    return {"token": token, "user": dict(user)}


def register(db: sqlite3.Connection, body: dict) -> dict:
    email = str(body.get("email", "")).strip().lower()
    password = str(body.get("password", ""))
    name = str(body.get("full_name", "")).strip() or email.split("@")[0]
    if "@" not in email or len(password) < 9:
        raise ApiError("Enter a valid email and a password of at least 9 characters.")
    user_id = new_id()
    digest = hashlib.pbkdf2_hmac("sha256", password.encode(), user_id.encode(), 120_000).hex()
    db.execute("INSERT INTO profiles(id,full_name,role) VALUES(?,?, 'customer')", (user_id, name))
    db.execute("INSERT INTO users(id,email,password_hash) VALUES(?,?,?)", (user_id, email, digest))
    db.execute(
        "INSERT INTO customers(id,user_id,display_name,email) VALUES(?,?,?,?)",
        (new_id(), user_id, name, email),
    )
    return {"ok": True}


def where_clause(params: dict[str, list[str]]) -> tuple[str, list[object]]:
    conditions, args = [], []
    for key, values in params.items():
        if key.startswith("eq_"):
            conditions.append(f'"{key[3:]}" = ?')
            args.append(values[0])
        elif key.startswith("ilike_"):
            conditions.append(f'"{key[6:]}" LIKE ? COLLATE NOCASE')
            args.append(values[0].replace("%", ""))
        elif key == "search_cols" and params.get("search"):
            columns = [column for column in values[0].split(",") if column.replace("_", "").isalnum()]
            if columns:
                conditions.append("(" + " OR ".join(f'"{column}" LIKE ? COLLATE NOCASE' for column in columns) + ")")
                args.extend([f"%{params['search'][0]}%"] * len(columns))
    return ("WHERE " + " AND ".join(conditions) if conditions else ""), args


def query_table(db: sqlite3.Connection, table: str, params: dict[str, list[str]]) -> list[dict]:
    where, args = where_clause(params)
    order = params.get("order", ["created_at.desc"])[0].split(".")
    order_column = order[0] if order[0].replace("_", "").isalnum() else "created_at"
    direction = "ASC" if len(order) > 1 and order[1] == "asc" else "DESC"
    limit = min(500, max(1, int(params.get("limit", ["100"])[0])))
    offset = max(0, int(params.get("offset", ["0"])[0]))
    rows = [dict(row) for row in db.execute(
        f'SELECT * FROM "{table}" {where} ORDER BY "{order_column}" {direction} LIMIT ? OFFSET ?',
        (*args, limit, offset),
    )]
    selection = params.get("select", [""])[0]
    if table == "invoices" and "customers(" in selection:
        for row in rows:
            row["customers"] = record(db.execute(
                "SELECT display_name,email,company FROM customers WHERE id=?", (row["customer_id"],)
            ).fetchone())
            row["invoice_lines"] = [dict(line) for line in db.execute(
                """SELECT id,description,quantity,unit_price,tax_rate,tax_amount,discount_amount,line_total
                   FROM invoice_lines WHERE invoice_id=?""", (row["id"],)
            )]
    return rows


def insert_record(db: sqlite3.Connection, table: str, values: dict, user: dict) -> dict:
    columns = {row["name"] for row in db.execute(f'PRAGMA table_info("{table}")')}
    values = {key: value for key, value in values.items() if key in columns and key not in {"id", "created_at", "updated_at"}}
    values["id"] = new_id()
    now = datetime.now().isoformat(timespec="seconds")
    if "updated_at" in columns:
        values["updated_at"] = now
    if "created_at" in columns:
        values["created_at"] = now
    if "created_by" in columns and not values.get("created_by"):
        values["created_by"] = user["id"]
    if table == "quotations":
        values.setdefault("number", next_number(db, "QUO", table))
    elif table == "invoices":
        values.setdefault("number", next_number(db, "INV", table))
    elif table == "subscriptions":
        values.setdefault("number", next_number(db, "SUB", table))
    elif table == "payments":
        values.setdefault("reference", next_number(db, "PAY", table))
    columns_sql = ",".join(f'"{key}"' for key in values)
    placeholders = ",".join("?" for _ in values)
    db.execute(f'INSERT INTO "{table}" ({columns_sql}) VALUES ({placeholders})', tuple(values.values()))
    return record(db.execute(f'SELECT * FROM "{table}" WHERE id=?', (values["id"],)).fetchone()) or {}


def update_records(db: sqlite3.Connection, table: str, values: dict, params: dict, user: dict) -> list[dict]:
    allowed = {row["name"] for row in db.execute(f'PRAGMA table_info("{table}")')}
    values = {key: value for key, value in values.items() if key in allowed and key not in {"id", "created_at"}}
    if "updated_at" in allowed:
        values["updated_at"] = datetime.now().isoformat(timespec="seconds")
    if not values:
        raise ApiError("No valid fields to update.")
    where, args = where_clause(params)
    columns_sql = ", ".join(f'"{column}"=?' for column in values)
    db.execute(f'UPDATE "{table}" SET {columns_sql} {where}', (*values.values(), *args))
    rows = db.execute(f'SELECT * FROM "{table}" {where}', args).fetchall()
    return [dict(row) for row in rows]


def dashboard_summary(db: sqlite3.Connection, months: int) -> dict:
    counts = lambda table, status: db.execute(f'SELECT COUNT(*) FROM "{table}" WHERE status=?', (status,)).fetchone()[0]
    active = counts("subscriptions", "active")
    paused = counts("subscriptions", "paused")
    cancelled = counts("subscriptions", "cancelled")
    collected = db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='succeeded'").fetchone()[0]
    outstanding = db.execute("SELECT COALESCE(SUM(balance_due),0) FROM invoices WHERE status IN ('draft','confirmed','overdue')").fetchone()[0]
    overdue = db.execute("SELECT COALESCE(SUM(balance_due),0) FROM invoices WHERE due_date < ? AND balance_due>0 AND status!='cancelled'", (today(),)).fetchone()[0]
    monthly_revenue, monthly_customers = [], []
    for offset in range(months - 1, -1, -1):
        start = (date.today().replace(day=1) - timedelta(days=offset * 31)).replace(day=1)
        month = start.strftime("%Y-%m")
        revenue = db.execute("SELECT COALESCE(SUM(amount),0) FROM payments WHERE status='succeeded' AND substr(payment_date,1,7)=?", (month,)).fetchone()[0]
        customers = db.execute("SELECT COUNT(*) FROM customers WHERE substr(created_at,1,7)=?", (month,)).fetchone()[0]
        monthly_revenue.append({"month": start.strftime("%b"), "revenue": revenue})
        monthly_customers.append({"month": start.strftime("%b"), "customers": customers})
    recent = [dict(row) for row in db.execute(
        """SELECT p.id,p.reference,p.amount,p.status,p.payment_date,c.display_name AS customer_name,i.number AS invoice_number
           FROM payments p JOIN customers c ON c.id=p.customer_id JOIN invoices i ON i.id=p.invoice_id
           ORDER BY p.payment_date DESC LIMIT 8"""
    )]
    return {
        "mrr": db.execute(
            """SELECT COALESCE(SUM(CASE billing_cycle WHEN 'yearly' THEN total/12.0 WHEN 'weekly' THEN total*4.3333
               WHEN 'daily' THEN total*30 ELSE total END),0) FROM subscriptions WHERE status='active'"""
        ).fetchone()[0],
        "total_collected": collected, "outstanding": outstanding, "overdue_amount": overdue,
        "active_count": active, "paused_count": paused, "cancelled_count": cancelled,
        "subscription_count": active + paused + cancelled,
        "customer_count": db.execute("SELECT COUNT(*) FROM customers").fetchone()[0],
        "outstanding_count": db.execute("SELECT COUNT(*) FROM invoices WHERE balance_due>0 AND status!='cancelled'").fetchone()[0],
        "overdue_count": db.execute("SELECT COUNT(*) FROM invoices WHERE due_date<? AND balance_due>0 AND status!='cancelled'", (today(),)).fetchone()[0],
        "monthly_revenue": monthly_revenue, "monthly_customers": monthly_customers, "recent_payments": recent,
    }


def run_function(db: sqlite3.Connection, name: str, body: dict, user: dict) -> dict:
    if name == "record-payment":
        invoice_id = str(body.get("invoice_id", ""))
        amount = float(body.get("amount", 0))
        invoice = db.execute("SELECT * FROM invoices WHERE id=?", (invoice_id,)).fetchone()
        if not invoice or amount <= 0 or amount > invoice["balance_due"]:
            raise ApiError("Payment amount must be positive and no greater than the invoice balance.")
        payment = insert_record(db, "payments", {
            "customer_id": invoice["customer_id"], "invoice_id": invoice_id, "amount": amount,
            "payment_method": body.get("payment_method", "other"), "payment_date": body.get("payment_date", today()),
            "notes": body.get("notes"), "recorded_by": user["id"],
        }, user)
        db.execute("INSERT INTO payment_allocations(id,payment_id,invoice_id,amount) VALUES(?,?,?,?)",
                   (new_id(), payment["id"], invoice_id, amount))
        balance = round(invoice["balance_due"] - amount, 2)
        db.execute("UPDATE invoices SET balance_due=?,status=?,updated_at=? WHERE id=?",
                   (balance, "paid" if balance == 0 else "confirmed", datetime.now().isoformat(), invoice_id))
        return payment
    if name == "subscription-action":
        sub_id, action = str(body.get("subscription_id", "")), str(body.get("action", ""))
        next_status = {"pause": "paused", "resume": "active", "cancel": "cancelled", "renew": "active"}.get(action)
        if not next_status:
            raise ApiError("Unsupported subscription action.")
        db.execute("UPDATE subscriptions SET status=?,updated_at=? WHERE id=?",
                   (next_status, datetime.now().isoformat(), sub_id))
        return {"ok": True, "status": next_status}
    if name == "quotation-workflows":
        quote_id, action = str(body.get("quotation_id", "")), str(body.get("action", ""))
        quote = db.execute("SELECT * FROM quotations WHERE id=?", (quote_id,)).fetchone()
        if not quote:
            raise ApiError("Quotation not found.", 404)
        if action in {"send", "confirm"}:
            status = "quotation" if action == "send" else "confirmed"
            db.execute("UPDATE quotations SET status=?,updated_at=? WHERE id=?",
                       (status, datetime.now().isoformat(), quote_id))
            return {"ok": True, "status": status}
        if action == "convert":
            line = db.execute("SELECT * FROM quotation_lines WHERE quotation_id=? LIMIT 1", (quote_id,)).fetchone()
            if not line:
                raise ApiError("Add at least one quotation line before converting.")
            if quote["status"] != "confirmed":
                raise ApiError("Confirm the quotation before converting it.")
            product = db.execute("SELECT * FROM products WHERE id=?", (line["product_id"],)).fetchone()
            plan = db.execute("SELECT id FROM subscription_plans WHERE product_id=? LIMIT 1", (line["product_id"],)).fetchone()
            if not plan:
                plan_id = new_id()
                db.execute("""INSERT INTO subscription_plans(id,product_id,name,billing_cycle,price)
                              VALUES(?,?,?,'monthly',?)""",
                           (plan_id, line["product_id"], product["name"] + " monthly", line["unit_price"]))
            else:
                plan_id = plan["id"]
            subscription_id = new_id()
            db.execute("""INSERT INTO subscriptions(id,number,customer_id,plan_id,quotation_id,billing_cycle,total)
                          VALUES(?,?,?,?,?,'monthly',?)""",
                       (subscription_id, next_number(db, "SUB", "subscriptions"), quote["customer_id"], plan_id, quote_id, quote["total"]))
            db.execute("""INSERT INTO subscription_lines(id,subscription_id,product_id,description,quantity,unit_price,tax_rate,discount_amount,line_total)
                          VALUES(?,?,?,?,?,?,?,?,?)""",
                       (new_id(), subscription_id, line["product_id"], line["description"], line["quantity"], line["unit_price"],
                        line["tax_rate"], line["discount_amount"], line["line_total"]))
            db.execute("UPDATE quotations SET status='active' WHERE id=?", (quote_id,))
            return {"ok": True, "subscription_id": subscription_id}
    if name == "run-billing":
        run_id = new_id()
        created = 0
        subs = db.execute("""SELECT s.*,p.name AS plan_name,p.product_id,p.price,p.billing_cycle AS plan_cycle,c.id AS cust_id
                             FROM subscriptions s JOIN subscription_plans p ON p.id=s.plan_id
                             JOIN customers c ON c.id=s.customer_id
                             WHERE s.status='active' AND s.next_billing_date<=?""", (today(),)).fetchall()
        for sub in subs:
            invoice_id = new_id()
            db.execute("""INSERT INTO invoices(id,number,customer_id,subscription_id,status,subtotal,total,balance_due,due_date,created_by)
                          VALUES(?,?,?,?,'confirmed',?,?,?, ?,?)""",
                       (invoice_id, next_number(db, "INV", "invoices"), sub["customer_id"], sub["id"], sub["price"],
                        sub["price"], sub["price"], today(), user["id"]))
            db.execute("""INSERT INTO invoice_lines(id,invoice_id,product_id,description,quantity,unit_price,line_total)
                          VALUES(?,?,?,?,1,?,?)""",
                       (new_id(), invoice_id, sub["product_id"], sub["plan_name"], sub["price"], sub["price"]))
            created += 1
        db.execute("INSERT INTO billing_runs(id,status,generated_count) VALUES(?,'completed',?)", (run_id, created))
        return {"generated": created, "message": f"{created} invoices generated"}
    if name == "create-staff":
        email = str(body.get("email", "")).strip().lower()
        password = str(body.get("password", ""))
        full_name = str(body.get("full_name", "")).strip()
        if "@" not in email or len(password) < 9 or not full_name:
            raise ApiError("Staff need a name, valid email, and password of at least 9 characters.")
        if not any(char.isupper() for char in password) or not any(char.islower() for char in password) or not any(not char.isalnum() for char in password):
            raise ApiError("Staff passwords must include uppercase, lowercase, and a special character.")
        profile_id = new_id()
        digest = hashlib.pbkdf2_hmac("sha256", password.encode(), profile_id.encode(), 120_000).hex()
        db.execute("INSERT INTO profiles(id,full_name,role) VALUES(?,?,'staff')", (profile_id, full_name))
        db.execute("INSERT INTO users(id,email,password_hash) VALUES(?,?,?)", (profile_id, email, digest))
        staff = insert_record(db, "staff", {
            "profile_id": profile_id, "full_name": full_name, "email": email,
            "permissions": json.dumps({"customers": True, "subscriptions": True, "invoices": True, "payments": True, "reports": True}),
        }, user)
        return staff
    raise ApiError(f"Unknown local function: {name}", 404)


if __name__ == "__main__":
    initialize()
    print(f"ORBIT local SQLite API listening at http://127.0.0.1:{PORT}")
    ThreadingHTTPServer(("127.0.0.1", PORT), Handler).serve_forever()

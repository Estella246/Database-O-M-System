from __future__ import annotations

import os

import psycopg
from psycopg.rows import dict_row

DB_DSN = os.getenv("DATABASE_URL", "postgresql://estella@localhost:5432/yunwei_ticket")


def db_conn() -> psycopg.Connection:
    return psycopg.connect(DB_DSN, row_factory=dict_row)
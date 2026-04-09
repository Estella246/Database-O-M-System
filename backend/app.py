from __future__ import annotations

import os
from datetime import date, datetime
from typing import Any, Optional

import psycopg
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from psycopg.rows import dict_row


DB_DSN = os.getenv("DATABASE_URL", "postgresql://estella@localhost:5432/yunwei_ticket")
SCHEMA_NODE_KEY = "problem_fill"
SCHEMA_TEMPLATE_CODE = "HCS_INCIDENT"

app = FastAPI(title="运维工单后端", version="0.2.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class SubmitPayload(BaseModel):
    values: dict[str, Any] = Field(default_factory=dict)
    operator_id: str = "demo_001"
    operator_name: str = "Demo User"
    next_node_key: Optional[str] = None


class PermissionPolicyItem(BaseModel):
    role_code: str
    is_pl: bool = False
    node_key: str
    field_key: str
    permission_level: str


class PermissionPolicyBulkPayload(BaseModel):
    items: list[PermissionPolicyItem] = Field(default_factory=list)
    operator_id: str = "admin"


class UserAccountItem(BaseModel):
    account: str
    user_name: str
    role_code: str
    group_name: str
    is_pl: bool = False
    is_active: bool = True


class UserAccountBulkPayload(BaseModel):
    items: list[UserAccountItem] = Field(default_factory=list)
    operator_id: str = "admin"


def db_conn() -> psycopg.Connection:
    return psycopg.connect(DB_DSN, row_factory=dict_row)


def _load_schema(conn: psycopg.Connection, node_key: str) -> list[dict[str, Any]]:
    rows = conn.execute(
        """
        SELECT
          nfd.field_key AS key,
          nfd.field_name AS label,
          nfd.required,
          nfd.read_only AS readonly,
          nfd.field_type AS type,
          nfd.default_type,
          nfd.default_value,
          nfd.constraints_json AS constraints,
          nfd.ui_props_json AS ui_props,
          os.set_code AS option_set_code
        FROM node_field_def nfd
        JOIN workflow_node wn ON wn.id = nfd.node_id
        JOIN workflow_template wt ON wt.id = wn.template_id
        LEFT JOIN option_set os ON os.id = nfd.option_set_id
        WHERE wt.template_code = %s
          AND wn.node_key = %s
          AND nfd.is_active = TRUE
        ORDER BY nfd.sort_order
        """,
        (SCHEMA_TEMPLATE_CODE, node_key),
    ).fetchall()

    if not rows:
        raise HTTPException(status_code=404, detail="Schema not found.")

    option_map: dict[str, list[str]] = {}
    option_codes = {r["option_set_code"] for r in rows if r["option_set_code"]}
    if option_codes:
        option_rows = conn.execute(
            """
            SELECT os.set_code, oi.option_value
            FROM option_set os
            JOIN option_item oi ON oi.option_set_id = os.id
            WHERE os.set_code = ANY(%s) AND oi.is_active = TRUE
            ORDER BY os.set_code, oi.sort_order
            """,
            (list(option_codes),),
        ).fetchall()
        for row in option_rows:
            option_map.setdefault(row["set_code"], []).append(row["option_value"])

    next_handler_map: dict[str, list[str]] = {}
    map_table = conn.execute(
        "SELECT to_regclass('public.handle_mode_next_handler_whitelist') AS name"
    ).fetchone()
    if map_table and map_table.get("name"):
        map_rows = conn.execute(
            """
            SELECT handle_mode, handler_value
            FROM handle_mode_next_handler_whitelist
            WHERE node_key = %s AND is_active = TRUE
            ORDER BY handle_mode, sort_order, id
            """,
            (node_key,),
        ).fetchall()
        for row in map_rows:
            next_handler_map.setdefault(str(row["handle_mode"]), []).append(str(row["handler_value"]))

    fields: list[dict[str, Any]] = []
    for row in rows:
        field = {
            "key": row["key"],
            "label": row["label"],
            "required": row["required"],
            "readonly": row["readonly"],
            "type": row["type"],
            "default_type": row["default_type"],
            "default_value": row["default_value"],
        }
        c = row.get("constraints")
        if isinstance(c, dict):
            field["constraints"] = c
        else:
            field["constraints"] = {}
        if row["key"] == "next_handler" and next_handler_map:
            field["constraints"]["next_handler_by_handle_mode"] = next_handler_map
        up = row.get("ui_props")
        if isinstance(up, dict):
            field["ui_props"] = up
        if row["option_set_code"]:
            options = option_map.get(row["option_set_code"], [])
            field["options"] = options if options else ["temp"]
        fields.append(field)

    return fields


def _field_visible(field: dict[str, Any], values: dict[str, Any]) -> bool:
    if field.get("key") == "next_handler" and str(values.get("handle_mode") or "") == "问题解决关闭":
        return False
    c = field.get("constraints") or {}
    rules = c.get("visible_when_all")
    if not rules:
        return True
    for rule in rules:
        dep = rule.get("field")
        allowed = rule.get("values") or []
        if values.get(dep) not in allowed:
            return False
    return True


def _matches_required_if(constraints: dict[str, Any], values: dict[str, Any]) -> bool:
    ri = constraints.get("required_if")
    if not ri:
        return False
    for dep_key, expected in ri.items():
        actual = values.get(dep_key)
        if isinstance(expected, list):
            if actual not in expected:
                return False
        else:
            if actual != expected:
                return False
    return True


def _optional_when_all_matches(constraints: dict[str, Any], values: dict[str, Any]) -> bool:
    rules = constraints.get("optional_when_all")
    if not rules:
        return False
    for rule in rules:
        dep = rule.get("field")
        allowed = rule.get("values") or []
        if values.get(dep) not in allowed:
            return False
    return True


def _optional_when_any_matches(constraints: dict[str, Any], values: dict[str, Any]) -> bool:
    rules = constraints.get("optional_when_any")
    if not rules:
        return False
    for rule in rules:
        dep = rule.get("field")
        allowed = rule.get("values") or []
        if values.get(dep) in allowed:
            return True
    return False


def _effective_required(field: dict[str, Any], values: dict[str, Any]) -> bool:
    c = field.get("constraints") or {}
    if not _field_visible(field, values):
        return False
    if _optional_when_any_matches(c, values) or _optional_when_all_matches(c, values):
        return False
    if c.get("required_when_visible"):
        return True
    if c.get("required_if"):
        return _matches_required_if(c, values)
    return bool(field.get("required", False))


def _apply_default(field: dict[str, Any], incoming: dict[str, Any], login_user: str) -> Any:
    key = field["key"]
    if key in incoming and incoming[key] not in (None, ""):
        return incoming[key]
    if field.get("default_type") == "today":
        return date.today().isoformat()
    if field.get("default_type") == "login_user":
        return login_user
    return field.get("default_value")


def _validate_one(field: dict[str, Any], value: Any) -> str | None:
    key = field["key"]
    field_type = field["type"]
    required = bool(field.get("required", False))

    if value in ("", None):
        return f"{key} is required" if required else None

    if field_type in ("text", "richtext"):
        if not isinstance(value, str):
            return f"{key} must be string"
        return None

    if field_type == "date":
        if not isinstance(value, str):
            return f"{key} must be date string"
        try:
            date.fromisoformat(value)
        except ValueError:
            return f"{key} must be YYYY-MM-DD"
        return None

    if field_type == "datetime":
        if not isinstance(value, str):
            return f"{key} must be datetime string"
        try:
            datetime.fromisoformat(value)
        except ValueError:
            return f"{key} must be ISO datetime"
        return None

    if field_type == "whitelist":
        options = field.get("options", [])
        if not isinstance(value, str):
            return f"{key} must be string option"
        if value not in options:
            return f"{key} must be one of {options}"
        return None

    return f"{key} has unsupported field type {field_type}"


def _get_or_create_ticket(
    conn: psycopg.Connection, ticket_no: str, operator_id: str, operator_name: str, initial_node_key: str = SCHEMA_NODE_KEY
) -> dict[str, Any]:
    row = conn.execute(
        """
        SELECT t.id, t.ticket_no, t.current_node_id
        FROM ticket t
        WHERE t.ticket_no = %s
        """,
        (ticket_no,),
    ).fetchone()
    if row:
        return row

    tmpl = conn.execute(
        "SELECT id FROM workflow_template WHERE template_code = %s",
        (SCHEMA_TEMPLATE_CODE,),
    ).fetchone()
    if not tmpl:
        raise HTTPException(status_code=500, detail="workflow template missing")

    node = conn.execute(
        """
        SELECT id
        FROM workflow_node
        WHERE template_id = %s AND node_key = %s
        """,
        (tmpl["id"], initial_node_key),
    ).fetchone()
    if not node:
        raise HTTPException(status_code=500, detail=f"workflow node missing: {initial_node_key}")

    created = conn.execute(
        """
        INSERT INTO ticket (ticket_no, template_id, title, current_node_id, status, creator_id, creator_name)
        VALUES (%s, %s, %s, %s, 'open', %s, %s)
        RETURNING id, ticket_no, current_node_id
        """,
        (ticket_no, tmpl["id"], f"Order {ticket_no}", node["id"], operator_id, operator_name),
    ).fetchone()
    return created


def _get_user_role(conn: psycopg.Connection, operator_id: str) -> tuple[str, bool]:
    row = conn.execute(
        """
        SELECT role_code, is_pl
        FROM user_account
        WHERE account = %s
        """,
        (operator_id,),
    ).fetchone()
    if not row:
        return "", False
    return str(row["role_code"] or ""), bool(row["is_pl"])


def _get_whitelist_flags(conn: psycopg.Connection, operator_id: str) -> dict[str, bool]:
    role_code, is_pl = _get_user_role(conn, operator_id)
    if not role_code:
        return {
            "ticket_list_only_self_created": False,
            "ticket_detail_only_problem_fill": False,
        }
    rows = conn.execute(
        """
        SELECT field_key, permission_level
        FROM role_permission_policy
        WHERE role_code = %s
          AND node_key = '__whitelist__'
          AND (is_pl = %s OR is_pl = FALSE)
        ORDER BY is_pl DESC, field_key
        """,
        (role_code, is_pl),
    ).fetchall()
    level_by_key: dict[str, str] = {}
    for row in rows:
        k = str(row["field_key"] or "")
        if not k or k in level_by_key:
            continue
        level_by_key[k] = str(row["permission_level"] or "hidden")
    return {
        "ticket_list_only_self_created": level_by_key.get("ticket_list_scope_self") == "editable",
        "ticket_detail_only_problem_fill": level_by_key.get("ticket_detail_scope_problem_fill") == "editable",
    }


@app.get("/health")
def health() -> dict[str, str]:
    with db_conn() as conn:
        conn.execute("SELECT 1")
    return {"status": "ok"}


@app.get("/api/tickets")
def list_tickets() -> dict[str, Any]:
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT
              t.ticket_no AS order_id,
              COALESCE(NULLIF(t.title, ''), t.ticket_no) AS subject,
              COALESCE(wn.node_key, '') AS node_key,
              COALESCE(wn.node_name, wn.node_key, '') AS node_name,
              COALESCE(t.creator_name, '') AS creator_name,
              TO_CHAR(t.created_at, 'YYYY-MM-DD') AS created_date,
              COALESCE(last_i.handler_name, t.creator_name, '') AS assignee
            FROM ticket t
            LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
            LEFT JOIN LATERAL (
              SELECT tni.handler_name
              FROM ticket_node_instance tni
              WHERE tni.ticket_id = t.id
              ORDER BY tni.id DESC
              LIMIT 1
            ) last_i ON TRUE
            ORDER BY t.created_at DESC, t.id DESC
            """
        ).fetchall()
    return {"items": rows}


@app.get("/api/permissions/effective")
def get_effective_permissions(operator_id: str = "demo_001") -> dict[str, Any]:
    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, operator_id)
    return {"operator_id": operator_id, "flags": flags}


@app.get("/api/admin/permissions")
def list_permission_policies() -> dict[str, Any]:
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at
            FROM role_permission_policy
            ORDER BY role_code, is_pl DESC, node_key, field_key
            """
        ).fetchall()
    return {"items": rows}


@app.post("/api/admin/permissions/bulk")
def upsert_permission_policies(payload: PermissionPolicyBulkPayload) -> dict[str, Any]:
    allowed = {"hidden", "readonly", "editable"}
    with db_conn() as conn:
        for item in payload.items:
            if item.permission_level not in allowed:
                raise HTTPException(status_code=400, detail=f"invalid permission_level: {item.permission_level}")
            conn.execute(
                """
                INSERT INTO role_permission_policy (
                  role_code, is_pl, node_key, field_key, permission_level, updated_by, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (role_code, is_pl, node_key, field_key)
                DO UPDATE SET
                  permission_level = EXCLUDED.permission_level,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = NOW()
                """,
                (
                    item.role_code.strip(),
                    item.is_pl,
                    item.node_key.strip(),
                    item.field_key.strip(),
                    item.permission_level.strip(),
                    payload.operator_id.strip() or "admin",
                ),
            )
        conn.commit()
    return {"ok": True, "count": len(payload.items)}


@app.get("/api/admin/users")
def list_users() -> dict[str, Any]:
    with db_conn() as conn:
        rows = conn.execute(
            """
            SELECT account, user_name, role_code, group_name, is_pl, is_active, updated_by, updated_at
            FROM user_account
            ORDER BY account
            """
        ).fetchall()
    return {"items": rows}


@app.post("/api/admin/users/bulk")
def upsert_users(payload: UserAccountBulkPayload) -> dict[str, Any]:
    with db_conn() as conn:
        for item in payload.items:
            conn.execute(
                """
                INSERT INTO user_account (
                  account, user_name, role_code, group_name, is_pl, is_active, updated_by, updated_at
                )
                VALUES (%s, %s, %s, %s, %s, %s, %s, NOW())
                ON CONFLICT (account)
                DO UPDATE SET
                  user_name = EXCLUDED.user_name,
                  role_code = EXCLUDED.role_code,
                  group_name = EXCLUDED.group_name,
                  is_pl = EXCLUDED.is_pl,
                  is_active = EXCLUDED.is_active,
                  updated_by = EXCLUDED.updated_by,
                  updated_at = NOW()
                """,
                (
                    item.account.strip(),
                    item.user_name.strip(),
                    item.role_code.strip(),
                    item.group_name.strip(),
                    item.is_pl,
                    item.is_active,
                    payload.operator_id.strip() or "admin",
                ),
            )
        conn.commit()
    return {"ok": True, "count": len(payload.items)}


@app.delete("/api/admin/permissions")
def delete_permission_policy(role_code: str, is_pl: bool, node_key: str, field_key: str) -> dict[str, Any]:
    with db_conn() as conn:
        conn.execute(
            """
            DELETE FROM role_permission_policy
            WHERE role_code = %s AND is_pl = %s AND node_key = %s AND field_key = %s
            """,
            (role_code, is_pl, node_key, field_key),
        )
        conn.commit()
    return {"ok": True}


@app.delete("/api/admin/users")
def delete_user(account: str) -> dict[str, Any]:
    with db_conn() as conn:
        conn.execute("DELETE FROM user_account WHERE account = %s", (account,))
        conn.commit()
    return {"ok": True}


@app.get("/api/nodes/{node_key}/schema")
def get_node_schema(node_key: str) -> dict[str, Any]:
    with db_conn() as conn:
        fields = _load_schema(conn, node_key)
    return {"node_key": node_key, "fields": fields}


@app.get("/api/tickets")
def list_tickets(operator_id: str = "demo_001") -> dict[str, Any]:
    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, operator_id)
        only_self = bool(flags.get("ticket_list_only_self_created"))
        rows = conn.execute(
            """
            SELECT
              t.ticket_no AS order_id,
              COALESCE(NULLIF(t.title, ''), CONCAT('Order ', t.ticket_no)) AS subject,
              COALESCE(t.status, 'open') AS status,
              COALESCE(t.creator_name, '') AS creator_name,
              COALESCE(t.creator_id, '') AS creator_id,
              COALESCE(wn.node_key, '') AS node_key,
              COALESCE(wn.node_name, UPPER(wn.node_key), '-') AS node,
              COALESCE(latest.values_json->>'problem_desc', latest.values_json->>'description', '--') AS description,
              COALESCE(latest.values_json->>'priority', 'High') AS priority,
              t.created_at::date::text AS sla
            FROM ticket t
            LEFT JOIN workflow_node wn ON wn.id = t.current_node_id
            LEFT JOIN LATERAL (
              SELECT tnd.values_json
              FROM ticket_node_data tnd
              WHERE tnd.ticket_id = t.id
              ORDER BY tnd.created_at DESC
              LIMIT 1
            ) latest ON TRUE
            WHERE (%s = FALSE OR t.creator_id = %s)
            ORDER BY t.created_at DESC, t.id DESC
            """,
            (only_self, operator_id),
        ).fetchall()
    items = [
        {
            "orderId": str(row["order_id"]),
            "subject": str(row["subject"]),
            "status": str(row["status"] or "open"),
            "node_key": str(row["node_key"] or ""),
            "priority": str(row["priority"] or "High"),
            "node": str(row["node"] or "-"),
            "assignee": str(row["creator_name"] or "-"),
            "description": str(row["description"] or "--"),
            "sla": str(row["sla"] or ""),
            "ecarePen": "-",
            "creatorName": str(row["creator_name"] or ""),
            "creatorId": str(row["creator_id"] or ""),
        }
        for row in rows
    ]
    return {"items": items}


@app.get("/api/tickets/{ticket_id}/nodes/{node_key}/data")
def get_node_data(ticket_id: str, node_key: str, operator_id: str = "demo_001") -> dict[str, Any]:
    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, operator_id)
        if flags.get("ticket_detail_only_problem_fill") and node_key != "problem_fill":
            raise HTTPException(status_code=403, detail="仅可查看问题填写节点")
        _ = _load_schema(conn, node_key)
        row = conn.execute(
            """
            SELECT tnd.values_json
            FROM ticket t
            JOIN ticket_node_data tnd ON tnd.ticket_id = t.id
            JOIN ticket_node_instance tni ON tni.id = tnd.ticket_node_instance_id
            JOIN workflow_node wn ON wn.id = tni.node_id
            WHERE t.ticket_no = %s AND wn.node_key = %s
            ORDER BY tnd.created_at DESC
            LIMIT 1
            """,
            (ticket_id, node_key),
        ).fetchone()
        values = row["values_json"] if row else {}
    return {"ticket_id": ticket_id, "node_key": node_key, "values": values}


@app.get("/api/tickets/{ticket_id}/logs")
def get_ticket_logs(ticket_id: str) -> dict[str, Any]:
    with db_conn() as conn:
        flow_rows = conn.execute(
            """
            SELECT
              tfl.created_at,
              tfl.operator_name,
              tfl.action_type,
              fn.node_name AS from_node_name,
              tn.node_name AS to_node_name
            FROM ticket_flow_log tfl
            JOIN ticket t ON t.id = tfl.ticket_id
            LEFT JOIN workflow_node fn ON fn.id = tfl.from_node_id
            LEFT JOIN workflow_node tn ON tn.id = tfl.to_node_id
            WHERE t.ticket_no = %s
            ORDER BY tfl.created_at ASC, tfl.id ASC
            """,
            (ticket_id,),
        ).fetchall()
        if flow_rows:
            items = [
                {
                    "at": row["created_at"].strftime("%Y-%m-%d %H:%M"),
                    "actor": str(row["operator_name"] or "-"),
                    "action": str(row["action_type"] or "submit"),
                    "from": str(row["from_node_name"] or "-"),
                    "to": str(row["to_node_name"] or "-"),
                }
                for row in flow_rows
            ]
            return {"ticket_id": ticket_id, "items": items}

        fallback_rows = conn.execute(
            """
            SELECT
              tni.created_at,
              tni.handler_name,
              tni.action_status,
              wn.node_name
            FROM ticket_node_instance tni
            JOIN ticket t ON t.id = tni.ticket_id
            JOIN workflow_node wn ON wn.id = tni.node_id
            WHERE t.ticket_no = %s
            ORDER BY tni.created_at ASC, tni.id ASC
            """,
            (ticket_id,),
        ).fetchall()
    if not fallback_rows:
        return {"ticket_id": ticket_id, "items": []}
    items = []
    prev_node = "-"
    for row in fallback_rows:
        curr = str(row["node_name"] or "-")
        items.append(
            {
                "at": row["created_at"].strftime("%Y-%m-%d %H:%M"),
                "actor": str(row["handler_name"] or "-"),
                "action": str(row["action_status"] or "completed"),
                "from": prev_node,
                "to": curr,
            }
        )
        prev_node = curr
    return {"ticket_id": ticket_id, "items": items}


@app.post("/api/tickets/{ticket_id}/nodes/{node_key}/submit")
def submit_node_data(ticket_id: str, node_key: str, payload: SubmitPayload) -> dict[str, Any]:
    with db_conn() as conn:
        flags = _get_whitelist_flags(conn, payload.operator_id)
        if flags.get("ticket_detail_only_problem_fill") and node_key != "problem_fill":
            raise HTTPException(status_code=403, detail="仅可处理问题填写节点")
        fields = _load_schema(conn, node_key)

        login_user = f"{payload.operator_id}+{payload.operator_name}"
        resolved: dict[str, Any] = dict(payload.values)
        for field in fields:
            key = field["key"]
            v = _apply_default(field, resolved, login_user)
            if key in payload.values and payload.values[key] not in (None, ""):
                v = payload.values[key]
            resolved[key] = v

        values: dict[str, Any] = {}
        errors: list[str] = []

        for field in fields:
            key = field["key"]
            value = resolved[key]
            if not _field_visible(field, resolved):
                continue
            req = _effective_required(field, resolved)
            field_for_val = {**field, "required": req}
            err = _validate_one(field_for_val, value)
            if err:
                errors.append(err)
            else:
                values[key] = value

        unknown_keys = set(payload.values.keys()) - {f["key"] for f in fields}
        if unknown_keys:
            errors.append(f"unknown fields: {sorted(unknown_keys)}")

        if errors:
            raise HTTPException(status_code=400, detail={"message": "Validation failed", "errors": errors})

        ticket = _get_or_create_ticket(conn, ticket_id, payload.operator_id, payload.operator_name, node_key)
        node = conn.execute(
            """
            SELECT wn.id
            FROM workflow_node wn
            JOIN workflow_template wt ON wt.id = wn.template_id
            WHERE wt.template_code = %s AND wn.node_key = %s
            """,
            (SCHEMA_TEMPLATE_CODE, node_key),
        ).fetchone()
        if not node:
            raise HTTPException(status_code=500, detail="workflow node missing")
        next_node = None
        next_node_key = str(payload.next_node_key or "").strip()
        if next_node_key:
            next_node = conn.execute(
                """
                SELECT wn.id
                FROM workflow_node wn
                JOIN workflow_template wt ON wt.id = wn.template_id
                WHERE wt.template_code = %s AND wn.node_key = %s
                LIMIT 1
                """,
                (SCHEMA_TEMPLATE_CODE, next_node_key),
            ).fetchone()
            if not next_node:
                raise HTTPException(status_code=400, detail=f"invalid next_node_key: {next_node_key}")
        if not next_node:
            next_node = node

        instance = conn.execute(
            """
            INSERT INTO ticket_node_instance (ticket_id, node_id, handler_id, handler_name, action_status)
            VALUES (%s, %s, %s, %s, 'completed')
            RETURNING id
            """,
            (ticket["id"], node["id"], payload.operator_id, payload.operator_name),
        ).fetchone()

        schema_snapshot = {"node_key": node_key, "fields": fields}
        conn.execute(
            """
            INSERT INTO ticket_node_data (ticket_id, ticket_node_instance_id, values_json, schema_snapshot, created_by)
            VALUES (%s, %s, %s::jsonb, %s::jsonb, %s)
            """,
            (ticket["id"], instance["id"], psycopg.types.json.Jsonb(values), psycopg.types.json.Jsonb(schema_snapshot), payload.operator_id),
        )
        conn.execute(
            """
            INSERT INTO ticket_flow_log (
              ticket_id, from_node_id, to_node_id, action_type, operator_id, operator_name, comment
            )
            VALUES (%s, %s, %s, 'submit', %s, %s, %s)
            """,
            (
                ticket["id"],
                node["id"],
                next_node["id"],
                payload.operator_id,
                payload.operator_name,
                "",
            ),
        )
        conn.execute(
            """
            UPDATE ticket
            SET current_node_id = %s,
                status = %s,
                updated_at = NOW()
            WHERE id = %s
            """,
            (
                next_node["id"],
                "closed" if str(values.get("handle_mode") or "") == "问题解决关闭" else "open",
                ticket["id"],
            ),
        )
        conn.commit()

    return {
        "ok": True,
        "ticket_id": ticket_id,
        "node_key": node_key,
        "saved": {
            "values": values,
            "updated_at": datetime.now().isoformat(),
            "operator_id": payload.operator_id,
            "operator_name": payload.operator_name,
        },
    }

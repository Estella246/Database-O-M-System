# 后端运行说明（PostgreSQL / GaussDB）

## 目标

- 使用数据库作为唯一数据源（字段定义、白名单、节点提交数据）。
- 前端接口路径保持不变。

## 运行

```bash
cd backend
python3 -m pip install -r requirements.txt
export DATABASE_URL="postgresql://estella@localhost:5432/yunwei_ticket"
python3 -m uvicorn app:app --reload --host 127.0.0.1 --port 8000 --no-access-log --log-level warning
```

默认会在存在仓库内 `frontend/index.html` 时一并托管前端，浏览器打开 `http://127.0.0.1:8000/` 即可；工单详情路径如 `/tickets/xxx` **刷新**也会返回页面而不是 404。若只需对外提供 API（不暴露静态页），可设置 `export SERVE_FRONTEND=0`。

若坚持前后端分端口：在 `frontend` 目录执行 `python3 serve_spa.py`（默认 8080），不要用 `python3 -m http.server`，否则刷新深链会 404。

## 核心接口

- `GET /health`
- `GET /api/nodes/problem_fill/schema`
- `GET /api/tickets/{ticket_id}/nodes/problem_fill/data`
- `POST /api/tickets/{ticket_id}/nodes/problem_fill/submit`

## 前置条件

- 已执行 `db/migrations/0001_init_workflow_schema.sql`。
- 数据库中存在模板 `HCS_INCIDENT` 与节点 `problem_fill`。

## 说明

- `GET schema` 从 `node_field_def + option_set + option_item` 读取。
- `POST submit` 会自动创建不存在的 `ticket`，并写入 `ticket_node_instance`、`ticket_node_data`。

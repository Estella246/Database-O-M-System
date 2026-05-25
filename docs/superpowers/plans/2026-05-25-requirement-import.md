# 需求导入功能实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 实现需求管理页面的Excel导入功能，包括下载模板、上传导入、新增/更新逻辑、权限控制。

**Architecture:** 参考现有导出功能和局点档案导入功能，后端新增两个接口（下载模板、导入），前端新增按钮和导入弹窗，使用 openpyxl 处理Excel。

**Tech Stack:** FastAPI、openpyxl、原生JavaScript、openpyxl样式

---

## File Structure

| 文件 | 责任 |
|------|------|
| `db/migrations/0065_requirement_import_whitelist.sql` | 新增 `requirement_import` 权限项 |
| `backend/models/requirement.py` | 新增 `RequirementImportPayload` Pydantic模型 |
| `backend/routers/requirement.py` | 新增下载模板接口和导入接口 |
| `frontend/modules/state/state.js` | 新增 `reqImportLoading`、`reqImportModalOpen` 状态 |
| `frontend/modules/pages/requirement-page.js` | 新增下载模板按钮、导入按钮、导入弹窗、交互逻辑 |
| `test/test_m10_requirement.py` | 新增导入功能单元测试 |

---

### Task 1: 数据库迁移 - 新增导入权限项

**Files:**
- Create: `db/migrations/0065_requirement_import_whitelist.sql`

- [ ] **Step 1: 编写迁移SQL**

```sql
-- 新增需求导入权限项（白名单控制）
-- 为 admin(PL) 和 管理员(非PL) 角色配置 requirement_import 权限

INSERT INTO role_permission_policy (role_code, is_pl, node_key, field_key, permission_level, updated_by) VALUES
  ('admin',   TRUE,  '__whitelist__', 'requirement_import', 'readonly', 'system'),
  ('管理员',  FALSE, '__whitelist__', 'requirement_import', 'readonly', 'system')
ON CONFLICT (role_code, is_pl, node_key, field_key)
DO UPDATE SET
  permission_level = EXCLUDED.permission_level,
  updated_by = EXCLUDED.updated_by,
  updated_at = NOW();
```

- [ ] **Step 2: 执行迁移验证**

Run: `psql "$DATABASE_URL" -f db/migrations/0065_requirement_import_whitelist.sql`
Expected: INSERT 0 2

- [ ] **Step 3: 提交**

```bash
git add db/migrations/0065_requirement_import_whitelist.sql
git commit -m "feat(db): 新增 requirement_import 权限项"
```

---

### Task 2: 后端模型 - 新增导入Payload

**Files:**
- Modify: `backend/models/requirement.py:43`

- [ ] **Step 1: 添加导入Payload模型**

在 `RequirementExportPayload` 后添加：

```python
class RequirementImportPayload(BaseModel):
    operator_id: str
```

- [ ] **Step 2: 提交**

```bash
git add backend/models/requirement.py
git commit -m "feat(models): 新增 RequirementImportPayload"
```

---

### Task 3: 后端接口 - 下载导入模板

**Files:**
- Modify: `backend/routers/requirement.py:701`

- [ ] **Step 1: 编写下载模板接口**

在 `export_requirements` 函数后添加：

```python
@router.get("/import-template")
def get_import_template(operator_id: str = "demo_001") -> StreamingResponse:
    """下载需求导入模板 Excel 文件。"""
    op = operator_id.strip() or "demo_001"
    try:
        with db_conn() as conn:
            wl = whitelist_field_levels(conn, op)
            if whitelist_permission_level(wl, "requirement_import") == "hidden":
                raise HTTPException(status_code=403, detail="无导入权限")
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc

    wb = Workbook()
    ws = wb.active
    ws.title = "需求导入模板"

    headers = [
        "需求编号", "需求标题", "详细描述", "需求提出人", "当前责任人",
        "关联问题", "需求单号", "计划落地版本", "计划落地日期",
        "优先级", "需求分类", "需求价值", "状态", "备注"
    ]
    header_font = Font(bold=True)
    header_alignment = Alignment(horizontal="center", vertical="center")
    thin_border = Border(
        left=Side(style="thin"),
        right=Side(style="thin"),
        top=Side(style="thin"),
        bottom=Side(style="thin")
    )

    for col_idx, header in enumerate(headers, start=1):
        cell = ws.cell(row=1, column=col_idx, value=header)
        cell.font = header_font
        cell.alignment = header_alignment
        cell.border = thin_border

    # 示例数据行
    example_values = [
        "",  # 需求编号（空则自动生成）
        "示例需求标题",
        "示例需求详细描述内容",
        "张三 zhangsan",
        "李四 lisi",
        "YW20260525001,DTS-001",  # 关联问题（逗号分隔）
        "EXT-2026-001",
        "V8.2.0",
        "2026-06-30",
        3,
        "管控需求",
        "性能提升",
        "",  # 状态（空则默认待分析）
        "示例备注信息"
    ]
    for col_idx, value in enumerate(example_values, start=1):
        cell = ws.cell(row=2, column=col_idx, value=value)
        cell.border = thin_border

    buf = BytesIO()
    wb.save(buf)
    buf.seek(0)

    encoded_filename = urllib.parse.quote("需求导入模板.xlsx", safe="")

    return StreamingResponse(
        buf,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f"attachment; filename=\"requirement_import_template.xlsx\"; filename*=UTF-8''{encoded_filename}"
        }
    )
```

- [ ] **Step 2: 运行测试验证现有功能不受影响**

Run: `pytest test/test_m10_requirement.py -v`
Expected: 全部通过

- [ ] **Step 3: 提交**

```bash
git add backend/routers/requirement.py
git commit -m "feat(api): 新增需求导入模板下载接口"
```

---

### Task 4: 后端接口 - 导入需求（核心逻辑）

**Files:**
- Modify: `backend/routers/requirement.py`

- [ ] **Step 1: 编写导入接口**

在 `get_import_template` 函数后添加导入接口。该接口实现：
- 解析Excel文件
- 全量校验（必填字段、格式、状态流转约束）
- 冲突检测（需求编号匹配）
- 执行新增或更新
- 返回结果或错误报告

```python
import re
from fastapi import UploadFile, File, Form

_REQ_NO_PATTERN = re.compile(r"^RQ\d{8}\d{3}$")  # RQYYYYMMDDnnn

def _validate_req_no_format(req_no: str) -> bool:
    """校验需求编号格式是否合法。"""
    return bool(_REQ_NO_PATTERN.match(str(req_no or "").strip()))

def _check_status_transition(old_status: str, new_status: str) -> tuple[bool, str]:
    """检查状态流转是否合法。返回 (是否合法, 错误消息)。"""
    if not new_status or new_status == old_status:
        return True, ""
    forward = REQUIREMENT_STATUS_FORWARD.get(old_status)
    backward = REQUIREMENT_STATUS_BACKWARD.get(old_status)
    if new_status == forward or new_status == backward:
        return True, ""
    return False, f"不允许从「{old_status}」流转至「{new_status}」，仅允许正向流转或回退一步"

def _parse_excel_import(file_content: bytes) -> tuple[list[dict], list[dict]]:
    """解析Excel导入文件，返回 (数据行列表, 错误列表)。"""
    from openpyxl import load_workbook
    
    wb = load_workbook(BytesIO(file_content))
    ws = wb.active
    
    rows = []
    errors = []
    
    # 获取表头映射
    headers = {}
    for col in range(1, ws.max_column + 1):
        header_val = ws.cell(row=1, column=col).value
        if header_val:
            headers[str(header_val).strip()] = col
    
    expected_headers = [
        "需求编号", "需求标题", "详细描述", "需求提出人", "当前责任人",
        "关联问题", "需求单号", "计划落地版本", "计划落地日期",
        "优先级", "需求分类", "需求价值", "状态", "备注"
    ]
    for h in expected_headers:
        if h not in headers:
            errors.append({"row": 1, "field": "表头", "message": f"缺少必填列：{h}"})
    
    if errors:
        return [], errors
    
    # 从第3行开始解析（跳过表头和示例行）
    for row_idx in range(3, ws.max_row + 1):
        row_data = {}
        for h, col in headers.items():
            val = ws.cell(row=row_idx, column=col).value
            row_data[h] = val if val is not None else ""
        
        # 跳过空行（标题为空）
        if not str(row_data.get("需求标题", "")).strip():
            continue
        
        row_data["_row_idx"] = row_idx
        rows.append(row_data)
    
    return rows, errors

@router.post("/import")
async def import_requirements(
    file: UploadFile = File(...),
    operator_id: str = Form(...),
) -> dict:
    """批量导入需求。"""
    op = operator_id.strip() or "demo_001"
    
    # 权限检查
    try:
        with db_conn() as conn:
            wl = whitelist_field_levels(conn, op)
            if whitelist_permission_level(wl, "requirement_import") == "hidden":
                raise HTTPException(status_code=403, detail="无导入权限")
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    
    # 文件格式检查
    if not file.filename or not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="仅支持 .xlsx 格式文件")
    
    # 解析Excel
    try:
        content = await file.read()
        rows, parse_errors = _parse_excel_import(content)
        if parse_errors:
            raise HTTPException(
                status_code=400,
                detail=json.dumps({"success": False, "error_type": "validation_failed", "errors": parse_errors})
            )
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=400, detail="文件无法解析，请检查文件格式") from e
    
    if not rows:
        return {"success": True, "total": 0, "created": 0, "updated": 0, "message": "导入成功，共0条需求"}
    
    # 全量校验
    validation_errors = []
    existing_reqs = {}  # requirement_no -> row data from DB
    
    try:
        with db_conn() as conn:
            # 预加载所有已有需求编号（用于冲突检测）
            all_req_nos = conn.execute("SELECT id, requirement_no, status FROM requirement").fetchall()
            for r in all_req_nos:
                req_no = str(r["requirement_no"] or "").strip()
                if req_no:
                    existing_reqs[req_no] = {"id": r["id"], "status": str(r["status"] or "")}
            
            operator_disp = _display_name_account(conn, op)
            
            # 校验每行数据
            for row_data in rows:
                row_idx = row_data["_row_idx"]
                
                # 必填字段校验
                title = str(row_data.get("需求标题", "")).strip()
                if not title:
                    validation_errors.append({"row": row_idx, "field": "需求标题", "message": "必填字段不能为空"})
                
                desc = str(row_data.get("详细描述", "")).strip()
                if not desc:
                    validation_errors.append({"row": row_idx, "field": "详细描述", "message": "必填字段不能为空"})
                
                proposer = str(row_data.get("需求提出人", "")).strip()
                if not proposer:
                    validation_errors.append({"row": row_idx, "field": "需求提出人", "message": "必填字段不能为空"})
                
                assignee = str(row_data.get("当前责任人", "")).strip()
                if not assignee:
                    validation_errors.append({"row": row_idx, "field": "当前责任人", "message": "必填字段不能为空"})
                
                # 优先级校验（宽松：无效值用默认值5）
                priority_raw = row_data.get("优先级", 5)
                try:
                    priority = int(priority_raw) if priority_raw else 5
                    if priority < 1 or priority > 10:
                        priority = 5
                except (ValueError, TypeError):
                    priority = 5
                
                # 需求分类校验（宽松：无效值用默认值"其他"）
                category = str(row_data.get("需求分类", "")).strip() or "其他"
                if category not in REQUIREMENT_CATEGORIES:
                    category = "其他"
                
                # 需求价值校验（宽松：无效值用默认值"质量加固"）
                req_value = str(row_data.get("需求价值", "")).strip() or "质量加固"
                if req_value not in REQUIREMENT_VALUES:
                    req_value = "质量加固"
                
                # 计划落地日期校验
                planned_date_raw = str(row_data.get("计划落地日期", "")).strip()
                planned_date_val = None
                if planned_date_raw:
                    try:
                        planned_date_val = datetime.strptime(planned_date_raw, "%Y-%m-%d").date()
                    except ValueError:
                        validation_errors.append({"row": row_idx, "field": "计划落地日期", "message": "日期格式错误，应为YYYY-MM-DD"})
                
                # 需求编号校验
                req_no = str(row_data.get("需求编号", "")).strip()
                is_update = False
                existing_id = None
                existing_status = None
                
                if req_no:
                    if not _validate_req_no_format(req_no):
                        validation_errors.append({"row": row_idx, "field": "需求编号", "message": "需求编号格式错误，应为RQ+8位日期+3位序号"})
                    elif req_no in existing_reqs:
                        is_update = True
                        existing_id = existing_reqs[req_no]["id"]
                        existing_status = existing_reqs[req_no]["status"]
                
                # 状态校验（仅更新模式需要检查流转约束）
                status_raw = str(row_data.get("状态", "")).strip()
                if status_raw and status_raw not in REQUIREMENT_STATUSES:
                    validation_errors.append({"row": row_idx, "field": "状态", "message": f"无效状态值：{status_raw}"})
                
                if is_update and existing_status:
                    # 已经落地的需求不允许更新
                    if existing_status == "已经落地":
                        validation_errors.append({"row": row_idx, "field": "状态", "message": "已经落地的需求不可通过导入变更"})
                    elif status_raw:
                        valid, err_msg = _check_status_transition(existing_status, status_raw)
                        if not valid:
                            validation_errors.append({"row": row_idx, "field": "状态", "message": err_msg})
                
                # 保存校验后的数据
                row_data["_validated"] = {
                    "title": title,
                    "description": desc,
                    "proposer": proposer,
                    "assignee": assignee,
                    "priority": priority,
                    "category": category,
                    "value": req_value,
                    "planned_date": planned_date_val,
                    "status": status_raw if status_raw in REQUIREMENT_STATUSES else "",
                    "is_update": is_update,
                    "existing_id": existing_id,
                    "existing_status": existing_status,
                }
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    
    if validation_errors:
        raise HTTPException(
            status_code=400,
            detail=json.dumps({"success": False, "error_type": "validation_failed", "errors": validation_errors})
        )
    
    # 执行导入（事务）
    created_count = 0
    updated_count = 0
    
    try:
        with db_conn() as conn:
            for row_data in rows:
                v = row_data["_validated"]
                
                # 关联问题解析（逗号分隔）
                related_raw = str(row_data.get("关联问题", "")).strip()
                related_issues = [x.strip() for x in related_raw.split(",") if x.strip()] if related_raw else []
                
                # 其他可选字段
                external_req_no = str(row_data.get("需求单号", "")).strip()
                planned_version = str(row_data.get("计划落地版本", "")).strip()
                remark = str(row_data.get("备注", "")).strip()
                
                if v["is_update"]:
                    # 更新模式
                    req_id = v["existing_id"]
                    old_row = conn.execute("SELECT * FROM requirement WHERE id = %s", (req_id,)).fetchone()
                    old = dict(old_row)
                    
                    updates: dict[str, Any] = {}
                    changed: dict[str, list] = {}
                    
                    simple_fields = {
                        "title": v["title"], "description": v["description"],
                        "proposer": v["proposer"], "assignee": v["assignee"],
                        "external_req_no": external_req_no, "planned_version": planned_version,
                        "remark": remark,
                    }
                    for field, new_val in simple_fields.items():
                        old_val = str(old.get(field, "") or "").strip()
                        if new_val != old_val:
                            updates[field] = new_val
                            changed[field] = [old_val, new_val]
                    
                    if v["category"] != str(old.get("category", "") or "").strip():
                        updates["category"] = v["category"]
                        changed["category"] = [str(old.get("category", "")), v["category"]]
                    if v["value"] != str(old.get("value", "") or "").strip():
                        updates["value"] = v["value"]
                        changed["value"] = [str(old.get("value", "")), v["value"]]
                    if v["priority"] != old["priority"]:
                        updates["priority"] = v["priority"]
                        changed["priority"] = [old["priority"], v["priority"]]
                    
                    if related_issues != (old.get("related_issues") or []):
                        updates["related_issues"] = psycopg.types.json.Jsonb(related_issues)
                        changed["related_issues"] = [old.get("related_issues") or [], related_issues]
                    
                    if v["planned_date"] != old.get("planned_date"):
                        updates["planned_date"] = v["planned_date"]
                        changed["planned_date"] = [str(old.get("planned_date") or ""), str(v["planned_date"] or "")]
                    
                    from_status = None
                    to_status = None
                    if v["status"]:
                        old_status = str(old.get("status", "") or "").strip()
                        if v["status"] != old_status:
                            updates["status"] = v["status"]
                            from_status = old_status
                            to_status = v["status"]
                    
                    if updates:
                        set_parts = [f"{k} = %s" for k in updates]
                        set_parts.append("updated_at = NOW()")
                        vals = list(updates.values())
                        vals.append(req_id)
                        conn.execute(
                            f"UPDATE requirement SET {', '.join(set_parts)} WHERE id = %s",
                            tuple(vals),
                        )
                        action = "status_changed" if to_status else "updated"
                        conn.execute(
                            """
                            INSERT INTO requirement_log (requirement_id, action, from_status, to_status, changed_fields, operator_id, operator_name, comment)
                            VALUES (%s, %s, %s, %s, %s::jsonb, %s, %s, %s)
                            """,
                            (req_id, action, from_status, to_status, psycopg.types.json.Jsonb(changed) if changed else None, op, operator_disp, ""),
                        )
                        updated_count += 1
                else:
                    # 新增模式
                    req_no_final = str(row_data.get("需求编号", "")).strip()
                    if not req_no_final:
                        req_no_final = _allocate_requirement_no(conn)
                    
                    status_final = v["status"] or "待分析"
                    
                    conn.execute(
                        """
                        INSERT INTO requirement (
                          requirement_no, title, description, proposer, assignee,
                          related_issues, external_req_no, planned_version, planned_date,
                          priority, category, value, remark, status, creator_id, creator_name
                        )
                        VALUES (%s, %s, %s, %s, %s, %s::jsonb, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        """,
                        (
                            req_no_final, v["title"], v["description"], v["proposer"], v["assignee"],
                            psycopg.types.json.Jsonb(related_issues), external_req_no, planned_version, v["planned_date"],
                            v["priority"], v["category"], v["value"], remark, status_final, op, operator_disp,
                        ),
                    )
                    # 获取新增的ID用于写日志
                    new_row = conn.execute(
                        "SELECT id FROM requirement WHERE requirement_no = %s",
                        (req_no_final,),
                    ).fetchone()
                    if new_row:
                        conn.execute(
                            """
                            INSERT INTO requirement_log (requirement_id, action, to_status, operator_id, operator_name, comment)
                            VALUES (%s, %s, %s, %s, %s, %s)
                            """,
                            (new_row["id"], "created", status_final, op, operator_disp, ""),
                        )
                    created_count += 1
            
            conn.commit()
    except UndefinedTable as exc:
        raise HTTPException(status_code=503, detail=f"需求管理表未就绪：{_REQUIREMENT_SCHEMA_HINT}") from exc
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"导入失败：{str(e)}") from e
    
    total = created_count + updated_count
    return {
        "success": True,
        "total": total,
        "created": created_count,
        "updated": updated_count,
        "message": f"成功导入{total}条需求（新增{created_count}条，更新{updated_count}条）"
    }
```

- [ ] **Step 2: 添加必要的import**

在文件顶部添加：

```python
import re
from fastapi import UploadFile, File, Form
```

- [ ] **Step 3: 运行测试验证**

Run: `pytest test/test_m10_requirement.py -v`
Expected: 全部通过

- [ ] **Step 4: 提交**

```bash
git add backend/routers/requirement.py
git commit -m "feat(api): 新增需求导入接口（支持新增和更新）"
```

---

### Task 5: 前端状态 - 新增导入相关状态

**Files:**
- Modify: `frontend/modules/state/state.js:276`

- [ ] **Step 1: 在 state 对象中添加导入状态**

在 `reqExportLoading: false,` 后添加：

```javascript
  reqImportLoading: false,
  reqImportModalOpen: false,
```

- [ ] **Step 2: 提交**

```bash
git add frontend/modules/state/state.js
git commit -m "feat(state): 新增 reqImportLoading 和 reqImportModalOpen 状态"
```

---

### Task 6: 前端页面 - 新增下载模板按钮

**Files:**
- Modify: `frontend/modules/pages/requirement-page.js:89-102`

- [ ] **Step 1: 添加导入权限检查和按钮**

修改 `renderRequirementPage` 函数中的权限检查部分：

```javascript
  const whitelist = getCurrentWhitelistSettings();
  const canCreate = whitelistAllows("requirement_create", "readonly", whitelist);
  const canExport = whitelistAllows("requirement_export", "readonly", whitelist);
  const canImport = whitelistAllows("requirement_import", "readonly", whitelist);
```

修改 `toolbarRightHtml`：

```javascript
  const toolbarRightHtml = `
  <div class="req-toolbar-right">
    ${canImport ? `<button type="button" class="action" id="req-download-template-btn">下载模板</button>` : ""}
    ${canImport ? `<button type="button" class="action" id="req-import-btn" ${state.reqImportLoading ? "disabled" : ""}>${state.reqImportLoading ? "导入中…" : "导入"}</button>` : ""}
    ${canExport ? `<button type="button" class="action" id="req-export-btn" ${state.reqExportLoading ? "disabled" : ""}>${state.reqExportLoading ? "导出中…" : "导出"}</button>` : ""}
    ${canCreate ? '<button type="button" class="action primary" id="req-create-btn">新建</button>' : ""}
  </div>`;
```

- [ ] **Step 2: 提交**

```bash
git add frontend/modules/pages/requirement-page.js
git commit -m "feat(ui): 新增下载模板和导入按钮"
```

---

### Task 7: 前端页面 - 新增导入弹窗HTML

**Files:**
- Modify: `frontend/modules/pages/requirement-page.js:658`

- [ ] **Step 1: 在 `renderRequirementModalsHtml` 函数中添加导入弹窗**

在函数末尾 `return createOpen + detail + editOpen;` 前添加导入弹窗：

```javascript
  const importOpen = state.reqImportModalOpen
    ? `<div class="perm-modal-mask req-modal-mask" id="req-import-mask">
        <div class="perm-modal req-modal req-import-modal" role="dialog">
          <div class="perm-modal-head"><h3>批量导入需求</h3></div>
          <div class="perm-modal-body">
            <p class="req-import-hint">请先下载模板，填写需求信息后上传。</p>
            <div class="req-import-upload-area">
              <input type="file" id="req-import-file" class="req-import-file-input" accept=".xlsx" />
              <div class="req-import-upload-hint">
                <span id="req-import-file-name">${state.reqImportFileName || "点击选择或拖拽文件"}</span>
              </div>
            </div>
            <div id="req-import-errors" class="req-import-errors"></div>
          </div>
          <div class="perm-modal-actions">
            <button type="button" class="action" id="req-import-cancel-btn">取消</button>
            <button type="button" class="action primary" id="req-import-submit-btn" ${state.reqImportLoading ? "disabled" : ""}>${state.reqImportLoading ? "导入中…" : "确认导入"}</button>
          </div>
        </div></div>`
    : "";

  return createOpen + detail + editOpen + importOpen;
```

- [ ] **Step 2: 提交**

```bash
git add frontend/modules/pages/requirement-page.js
git commit -m "feat(ui): 新增导入弹窗HTML"
```

---

### Task 8: 前端页面 - 新增导入交互逻辑

**Files:**
- Modify: `frontend/modules/pages/requirement-page.js:661-1038`

- [ ] **Step 1: 在 `bindRequirementPage` 函数中添加下载模板按钮事件**

在导出按钮事件前添加：

```javascript
  // 下载模板按钮
  document.getElementById("req-download-template-btn")?.addEventListener("click", async () => {
    const op = getCurrentOperator();
    try {
      const resp = await fetch(`${API_BASE_URL}/api/requirements/import-template?operator_id=${encodeURIComponent(op.account)}`);
      if (!resp.ok) {
        const text = await resp.text();
        if (resp.status === 403) {
          window.alert("无导入权限");
        } else {
          window.alert(`下载模板失败：${text.slice(0, 200)}`);
        }
        return;
      }
      const disposition = resp.headers.get("Content-Disposition") || "";
      const filenameMatch = disposition.match(/filename\*?=(?:UTF-8'')?([^;]+)/i);
      const filename = filenameMatch ? decodeURIComponent(filenameMatch[1].replace(/"/g, "")) : "需求导入模板.xlsx";

      const blob = await resp.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (e) {
      window.alert(`下载模板失败：${String(e.message || e)}`);
    }
  });
```

- [ ] **Step 2: 添加导入按钮事件**

在下载模板按钮事件后添加：

```javascript
  // 导入按钮
  document.getElementById("req-import-btn")?.addEventListener("click", () => {
    state.reqImportModalOpen = true;
    state.reqImportFileName = "";
    requestRender();
  });
```

- [ ] **Step 3: 添加导入弹窗交互事件**

在导出按钮事件后添加：

```javascript
  // 导入弹窗交互
  document.getElementById("req-import-cancel-btn")?.addEventListener("click", () => {
    state.reqImportModalOpen = false;
    state.reqImportFileName = "";
    requestRender();
  });
  document.getElementById("req-import-mask")?.addEventListener("click", (ev) => {
    if (ev.target === document.getElementById("req-import-mask")) {
      state.reqImportModalOpen = false;
      state.reqImportFileName = "";
      requestRender();
    }
  });
  const importFileInput = document.getElementById("req-import-file");
  if (importFileInput) {
    importFileInput.addEventListener("change", () => {
      const file = importFileInput.files?.[0];
      if (file) {
        if (!file.name.toLowerCase().endsWith(".xlsx")) {
          window.alert("仅支持 .xlsx 格式文件");
          importFileInput.value = "";
          state.reqImportFileName = "";
          requestRender();
          return;
        }
        state.reqImportFileName = file.name;
        requestRender();
      }
    });
  }
  document.getElementById("req-import-submit-btn")?.addEventListener("click", async () => {
    const fileInput = document.getElementById("req-import-file");
    const file = fileInput?.files?.[0];
    if (!file) {
      window.alert("请选择文件");
      return;
    }
    const op = getCurrentOperator();
    state.reqImportLoading = true;
    requestRender();
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("operator_id", op.account);
      const resp = await fetch(`${API_BASE_URL}/api/requirements/import`, {
        method: "POST",
        body: formData,
      });
      const text = await resp.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        body = { detail: text };
      }
      if (!resp.ok) {
        if (resp.status === 403) {
          window.alert("无导入权限");
        } else if (body.error_type === "validation_failed" && body.errors) {
          const errorsDiv = document.getElementById("req-import-errors");
          if (errorsDiv) {
            const errorHtml = body.errors.map((e) => 
              `<div class="req-import-error-item">第${e.row}行 · ${e.field}：${escapeHtml(e.message)}</div>`
            ).join("");
            errorsDiv.innerHTML = errorHtml;
          }
        } else {
          window.alert(`导入失败：${body.detail || text.slice(0, 200)}`);
        }
        return;
      }
      state.reqImportModalOpen = false;
      state.reqImportFileName = "";
      state.reqImportLoading = false;
      requestRender();
      window.alert(body.message || "导入成功");
      await fetchReqList();
    } catch (e) {
      window.alert(`导入失败：${String(e.message || e)}`);
    } finally {
      state.reqImportLoading = false;
      requestRender();
    }
  });
```

- [ ] **Step 4: 添加 `reqImportFileName` 到状态**

在 `frontend/modules/state/state.js` 中添加：

```javascript
  reqImportFileName: "",
```

- [ ] **Step 5: 提交**

```bash
git add frontend/modules/pages/requirement-page.js frontend/modules/state/state.js
git commit -m "feat(ui): 完成导入交互逻辑"
```

---

### Task 9: 前端样式 - 导入弹窗样式

**Files:**
- Modify: `frontend/styles/requirement.css`

- [ ] **Step 1: 添加导入弹窗样式**

```css
/* 导入弹窗样式 */
.req-import-modal {
  max-width: 480px;
}
.req-import-hint {
  margin-bottom: 16px;
  color: #666;
}
.req-import-upload-area {
  border: 2px dashed #ccc;
  border-radius: 8px;
  padding: 24px;
  text-align: center;
  margin-bottom: 16px;
  position: relative;
}
.req-import-upload-area:hover {
  border-color: #409eff;
}
.req-import-file-input {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  opacity: 0;
  cursor: pointer;
}
.req-import-upload-hint {
  color: #409eff;
}
.req-import-errors {
  max-height: 200px;
  overflow-y: auto;
  margin-top: 16px;
}
.req-import-error-item {
  padding: 8px 12px;
  background: #fff3f3;
  border: 1px solid #ffccc7;
  border-radius: 4px;
  margin-bottom: 8px;
  color: #cf1322;
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/styles/requirement.css
git commit -m "feat(ui): 新增导入弹窗样式"
```

---

### Task 10: 后端测试 - 导入接口测试

**Files:**
- Modify: `test/test_m10_requirement.py`

- [ ] **Step 1: 新增导入测试类**

在文件末尾添加：

```python
import io

class TestRequirementImport:
    def test_tc_m10_069_download_template(self, api_client):
        """测试下载导入模板"""
        resp = api_client.get("/api/requirements/import-template", params={"operator_id": "test_admin"})
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        assert "attachment" in resp.headers.get("content-disposition", "")
        content = resp.content
        assert len(content) > 0
        assert content[:2] == b"PK"  # Excel 文件魔数

    def test_tc_m10_070_download_template_no_permission(self, api_client):
        """测试无权限下载模板"""
        resp = api_client.get("/api/requirements/import-template", params={"operator_id": "no_permission_user"})
        assert resp.status_code == 403

    def test_tc_m10_071_import_empty_file(self, api_client):
        """测试导入空文件"""
        # 先下载模板
        template_resp = api_client.get("/api/requirements/import-template", params={"operator_id": "test_admin"})
        assert template_resp.status_code == 200
        
        # 上传模板（仅表头和示例行，无实际数据）
        files = {"file": ("template.xlsx", template_resp.content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {"operator_id": "test_admin"}
        resp = api_client.post("/api/requirements/import", files=files, data=data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["total"] == 0
        assert body["message"] == "导入成功，共0条需求"

    def test_tc_m10_072_import_create_new(self, api_client):
        """测试导入新增需求"""
        # 创建一个简单的Excel文件（仅包含一行数据）
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        ws.title = "需求导入模板"
        
        headers = [
            "需求编号", "需求标题", "详细描述", "需求提出人", "当前责任人",
            "关联问题", "需求单号", "计划落地版本", "计划落地日期",
            "优先级", "需求分类", "需求价值", "状态", "备注"
        ]
        for col_idx, header in enumerate(headers, start=1):
            ws.cell(row=1, column=col_idx, value=header)
        
        # 示例行
        example_values = ["", "示例标题", "示例描述", "张三", "李四", "", "", "", "", 5, "其他", "质量加固", "", ""]
        for col_idx, value in enumerate(example_values, start=1):
            ws.cell(row=2, column=col_idx, value=value)
        
        # 实际数据行
        data_values = ["", "导入测试需求", "导入测试描述", "测试提出人", "测试责任人", "", "", "", "", 3, "管控需求", "性能提升", "", "导入备注"]
        for col_idx, value in enumerate(data_values, start=1):
            ws.cell(row=3, column=col_idx, value=value)
        
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        
        files = {"file": ("import.xlsx", buf.read(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {"operator_id": "test_admin"}
        resp = api_client.post("/api/requirements/import", files=files, data=data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["created"] >= 1

    def test_tc_m10_073_import_missing_required(self, api_client):
        """测试导入缺少必填字段"""
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        
        headers = [
            "需求编号", "需求标题", "详细描述", "需求提出人", "当前责任人",
            "关联问题", "需求单号", "计划落地版本", "计划落地日期",
            "优先级", "需求分类", "需求价值", "状态", "备注"
        ]
        for col_idx, header in enumerate(headers, start=1):
            ws.cell(row=1, column=col_idx, value=header)
        
        # 缺少标题
        data_values = ["", "", "描述内容", "提出人", "责任人", "", "", "", "", 5, "其他", "质量加固", "", ""]
        for col_idx, value in enumerate(data_values, start=1):
            ws.cell(row=2, column=col_idx, value=value)
        
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        
        files = {"file": ("import.xlsx", buf.read(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {"operator_id": "test_admin"}
        resp = api_client.post("/api/requirements/import", files=files, data=data)
        assert resp.status_code == 400

    def test_tc_m10_074_import_invalid_date(self, api_client):
        """测试导入无效日期格式"""
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        
        headers = [
            "需求编号", "需求标题", "详细描述", "需求提出人", "当前责任人",
            "关联问题", "需求单号", "计划落地版本", "计划落地日期",
            "优先级", "需求分类", "需求价值", "状态", "备注"
        ]
        for col_idx, header in enumerate(headers, start=1):
            ws.cell(row=1, column=col_idx, value=header)
        
        data_values = ["", "标题", "描述", "提出人", "责任人", "", "", "", "invalid-date", 5, "其他", "质量加固", "", ""]
        for col_idx, value in enumerate(data_values, start=1):
            ws.cell(row=2, column=col_idx, value=value)
        
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        
        files = {"file": ("import.xlsx", buf.read(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {"operator_id": "test_admin"}
        resp = api_client.post("/api/requirements/import", files=files, data=data)
        assert resp.status_code == 400

    def test_tc_m10_075_import_update_existing(self, api_client):
        """测试导入更新已有需求"""
        # 先创建一条需求
        create_resp = api_client.post("/api/requirements", json={
            "operator_id": "test_admin",
            "title": "原始标题",
            "description": "原始描述",
            "proposer": "原始提出人",
            "assignee": "原始责任人",
            "priority": 5,
        })
        assert create_resp.status_code == 200
        req_no = create_resp.json()["requirement_no"]
        
        # 导入更新该需求
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        
        headers = [
            "需求编号", "需求标题", "详细描述", "需求提出人", "当前责任人",
            "关联问题", "需求单号", "计划落地版本", "计划落地日期",
            "优先级", "需求分类", "需求价值", "状态", "备注"
        ]
        for col_idx, header in enumerate(headers, start=1):
            ws.cell(row=1, column=col_idx, value=header)
        
        data_values = [req_no, "更新标题", "更新描述", "更新提出人", "更新责任人", "", "", "", "", 1, "内核需求", "竞争力提升", "", "更新备注"]
        for col_idx, value in enumerate(data_values, start=1):
            ws.cell(row=2, column=col_idx, value=value)
        
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        
        files = {"file": ("import.xlsx", buf.read(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {"operator_id": "test_admin"}
        resp = api_client.post("/api/requirements/import", files=files, data=data)
        assert resp.status_code == 200
        body = resp.json()
        assert body["success"] is True
        assert body["updated"] >= 1

    def test_tc_m10_076_import_status_invalid_jump(self, api_client):
        """测试导入状态跨步流转被拒绝"""
        # 创建一条待分析状态的需求
        create_resp = api_client.post("/api/requirements", json={
            "operator_id": "test_admin",
            "title": "状态流转测试",
            "description": "状态流转描述",
            "proposer": "提出人",
            "assignee": "责任人",
            "priority": 5,
        })
        assert create_resp.status_code == 200
        req_no = create_resp.json()["requirement_no"]
        
        # 尝试导入更新为已经落地（跨步）
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        
        headers = [
            "需求编号", "需求标题", "详细描述", "需求提出人", "当前责任人",
            "关联问题", "需求单号", "计划落地版本", "计划落地日期",
            "优先级", "需求分类", "需求价值", "状态", "备注"
        ]
        for col_idx, header in enumerate(headers, start=1):
            ws.cell(row=1, column=col_idx, value=header)
        
        data_values = [req_no, "标题", "描述", "提出人", "责任人", "", "", "", "", 5, "其他", "质量加固", "已经落地", ""]
        for col_idx, value in enumerate(data_values, start=1):
            ws.cell(row=2, column=col_idx, value=value)
        
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        
        files = {"file": ("import.xlsx", buf.read(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {"operator_id": "test_admin"}
        resp = api_client.post("/api/requirements/import", files=files, data=data)
        assert resp.status_code == 400

    def test_tc_m10_077_import_landed_cannot_update(self, api_client):
        """测试已经落地的需求不能通过导入更新"""
        # 创建并流转到已经落地
        create_resp = api_client.post("/api/requirements", json={
            "operator_id": "test_admin",
            "title": "落地测试",
            "description": "落地描述",
            "proposer": "提出人",
            "assignee": "责任人",
            "priority": 5,
        })
        assert create_resp.status_code == 200
        req_id = create_resp.json()["id"]
        req_no = create_resp.json()["requirement_no"]
        
        # 流转到已经落地
        api_client.patch(f"/api/requirements/{req_id}", json={"operator_id": "test_admin", "status": "待RAT决策"})
        api_client.patch(f"/api/requirements/{req_id}", json={"operator_id": "test_admin", "status": "开发中"})
        api_client.patch(f"/api/requirements/{req_id}", json={"operator_id": "test_admin", "status": "已经落地"})
        
        # 尝试导入更新
        from openpyxl import Workbook
        wb = Workbook()
        ws = wb.active
        
        headers = [
            "需求编号", "需求标题", "详细描述", "需求提出人", "当前责任人",
            "关联问题", "需求单号", "计划落地版本", "计划落地日期",
            "优先级", "需求分类", "需求价值", "状态", "备注"
        ]
        for col_idx, header in enumerate(headers, start=1):
            ws.cell(row=1, column=col_idx, value=header)
        
        data_values = [req_no, "新标题", "新描述", "新提出人", "新责任人", "", "", "", "", 5, "其他", "质量加固", "", "新备注"]
        for col_idx, value in enumerate(data_values, start=1):
            ws.cell(row=2, column=col_idx, value=value)
        
        buf = io.BytesIO()
        wb.save(buf)
        buf.seek(0)
        
        files = {"file": ("import.xlsx", buf.read(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
        data = {"operator_id": "test_admin"}
        resp = api_client.post("/api/requirements/import", files=files, data=data)
        assert resp.status_code == 400
```

- [ ] **Step 2: 运行测试验证**

Run: `pytest test/test_m10_requirement.py::TestRequirementImport -v`
Expected: 全部通过

- [ ] **Step 3: 提交**

```bash
git add test/test_m10_requirement.py
git commit -m "test(requirement): 新增导入接口测试用例"
```

---

### Task 11: E2E测试 - 导入功能E2E测试

**Files:**
- Modify: `test/e2e/test_e2e_requirement.py`

- [ ] **Step 1: 新增导入E2E测试**

```python
class TestE2ERequirementImport:
    def test_e2e_req_import_page_load(self, e2e_page):
        """测试导入弹窗可打开"""
        e2e_page.goto("/requirements")
        e2e_page.wait_for_selector("#req-management-panel", timeout=10000)
        
        # 检查导入按钮是否存在（需要有权限的用户）
        import_btn = e2e_page.query_selector("#req-import-btn")
        if import_btn:
            import_btn.click()
            e2e_page.wait_for_selector("#req-import-mask", timeout=5000)
            assert e2e_page.query_selector("#req-import-file") is not None
            
            # 关闭弹窗
            cancel_btn = e2e_page.query_selector("#req-import-cancel-btn")
            if cancel_btn:
                cancel_btn.click()
                e2e_page.wait_for_selector("#req-import-mask", state="hidden", timeout=5000)

    def test_e2e_req_download_template(self, e2e_page, tmp_path):
        """测试下载模板按钮"""
        e2e_page.goto("/requirements")
        e2e_page.wait_for_selector("#req-management-panel", timeout=10000)
        
        download_btn = e2e_page.query_selector("#req-download-template-btn")
        if download_btn:
            with e2e_page.expect_download() as download_info:
                download_btn.click()
            download = download_info.value
            assert download.suggested_filename.endswith(".xlsx")
```

- [ ] **Step 2: 运行E2E测试验证**

Run: `pytest test/e2e/test_e2e_requirement.py::TestE2ERequirementImport -v`
Expected: 通过

- [ ] **Step 3: 提交**

```bash
git add test/e2e/test_e2e_requirement.py
git commit -m "test(e2e): 新增需求导入E2E测试"
```

---

### Task 12: 更新README

**Files:**
- Modify: `README.md`

- [ ] **Step 1: 在需求管理章节添加导入说明**

在需求管理章节的导出功能说明后添加：

```markdown
- 导入功能：点击「下载模板」获取Excel模板，填写后点击「导入」上传实现批量导入
  - 需求编号为空时自动生成新编号，填写已有编号时更新该需求
  - 权限项 `requirement_import` 控制按钮显示
```

- [ ] **Step 2: 提交**

```bash
git add README.md
git commit -m "docs: 更新 README 补充需求导入功能说明"
```

---

## Self-Review Checklist

**1. Spec coverage:**
- ✅ 权限控制 - Task 1
- ✅ 导入字段（14个）- Task 3, 4
- ✅ 模板文件设计 - Task 3
- ✅ 冲突检测（需求编号）- Task 4
- ✅ 状态流转约束 - Task 4
- ✅ 下载模板接口 - Task 3
- ✅ 导入接口 - Task 4
- ✅ 前端按钮和弹窗 - Task 6, 7, 8
- ✅ 错误处理 - Task 4, 8
- ✅ 测试用例 - Task 10, 11

**2. Placeholder scan:** 无 TBD/TODO

**3. Type consistency:**
- 所有函数签名匹配
- 状态字段名统一使用 `reqImportLoading`, `reqImportModalOpen`, `reqImportFileName`
# 上级在研田修改级联下级：测试与修改报告

- **日期**：2026-08-18
- **分支**：`qi_analytic_improve`（基于 `2e4b59d`，紧随《三级以下节点支持配置在研责任田》）
- **任务**：要求修改上级责任田的在研田时，下级责任田也级联修改
- **流程**：ops-dev-workflow 5 阶段闭环（任务 #51-#55）

## 一、任务概述

深节点配置（上一任务）落地后，上级节点绑定在研田只写自身槽位，下级不受影响，与「上级改田、下级跟着改」的
运营预期不符。本次实现**全量级联写入 + 仅自身解除 + 继承角标**三件套（口径经 AskUserQuestion 确认）：

1. **级联范围 = 全量写入所有下级**：树节点弹窗打开时按树枚举该节点子树**全部**下级槽位（含各层级），
   保存时随 `cascade_slots` 一并提交；后端单事务 upsert 自身 + 全部下级槽位为同一田，下级原有绑定被覆盖。
2. **解除联动 = 仅解除自身**：解除（field_id=null）只删本节点槽位，下级绑定保持不变（显式忽略 cascade_slots）。
3. **继承角标 = 显示继承田**：未绑定节点按模块路径逐级向上回退找最近祖先槽位，命中则角标显示
   「在研：田X（继承）」并加 `--inherited` 弱化样式；回退到整领域槽位亦算继承。

## 二、计划与评审记录

- AskUserQuestion 单轮 4 问评审，结论：级联范围「全量写入所有下级」、解除联动「仅解除自身」、
  继承角标「显示继承田（推荐）」、计划评审「通过，开始开发」。无偏离。
- 方案要点：前端枚举子树槽位（与树渲染同一数据源，避免后端做树标签匹配）、后端保持树无关——
  只校验并 upsert 显式槽位列表；绑定表 `research_duty_field_binding` 结构不变。

## 三、修改清单

| 文件 | 变更 |
|---|---|
| `backend/models/params.py` | 新增 `ResearchDutyFieldCascadeSlot`（domain/module）；`ResearchDutyFieldBindingPayload` 增 `cascade_slots: List[...]`（默认空） |
| `backend/routers/params.py` | `put_research_duty_field_binding` 重写：绑定（field_id 非 null）时校验级联槽位——领域须与主槽位一致（400「级联槽位领域需与主槽位一致」）、模块非空（400）、≤256（400）、去重（主槽位重复/列表内重复跳过）、≤1000（400「级联槽位数量不能超过 1000」）；抽取 `_upsert_slot` helper（SELECT→UPDATE/INSERT/DELETE，GaussDB 保守不用 ON CONFLICT）；单事务写自身 + 全部级联槽位；解除路径忽略 cascade_slots 仅删自身 |
| `frontend/modules/pages/research-duty-field-params.js` | 新增 `researchFieldRowEffectiveFor(domain, module)`（自身→逐级父前缀→整领域回退，返回 `{row, inherited}`）；新增 `collectResearchCascadeSlots(tree, parts, baseModule)`（枚举子树全部下级槽位，模块路径按 `/` 连接；空标签节点自身不出槽位但子级继续下钻——防御分支）；`openResearchFieldNodeModal` 增 `cascadeSlots` 参数入 state；提交体携带 `cascade_slots`（解除时为 `[]`）；弹窗展示级联数量提示「保存后将同时为 N 个下级节点绑定该田（下级原有绑定会被覆盖）；解除关联仅作用于本节点」；解除 confirm 文案注明「仅解除本节点，下级绑定不变；田仍保留在参数配置中」 |
| `frontend/modules/pages/ticket-page.js` | 树节点角标数据源改用 `researchFieldRowEffectiveFor`：命中继承时显示「（继承）」后缀并加 `duty-field-research-badge--inherited` 弱化样式类（title 同步）；「在研」点击 handler 在打开弹窗前用 `collectResearchCascadeSlots` 枚举下级槽位传入 |
| `frontend/modules/state/state.js` | 新增 `researchFieldNodeCascadeSlots: []` |
| `frontend/styles/duty.css` | 新增 `.duty-field-research-badge--inherited` 弱化配色（灰字/浅底/灰边） |
| `test/test_m07_params.py` | `_put_binding` helper 增 `cascade_slots` 参数；新增 3 用例：`binding_cascade_write`（整域+模块换绑两向级联、覆盖下级原绑定）、`binding_unbind_no_cascade`（解除仅删自身、下级保留）、`binding_cascade_validations`（领域不一致/模块空/超长/超 1000/去重/全部非法时零副作用） |
| `test/e2e/test_e2e_qi_research_field.py` | 新增 `test_tree_cascade_write_and_badge_inheritance`（4 步：①绑定 A1→田一全量级联+弹窗级联数量提示+全子树自身角标；②解除 X 仅自身+confirm 文案+X 角标变「田一（继承）」含样式类；③换绑 A1→田二全量覆盖（按模块排序断言，绑定表 id 序不敏感）+田一清空；④整域绑定级联覆盖全部子树后解除 A1 仅自身→A1 角标经模块路径回退落整领域槽位显示「田一（继承）」）；3 个既有用例的角标选择器改用 `> .duty-field-row` 子组合器（级联后 `li` 含嵌套子树角标，避免 strict-mode 多元素）；`test_tree_domain_node_binds_whole_domain_slot`/`test_tree_and_panel_cross_entry_consistency`/`test_tree_module_node_binds_module_slot` 的 scopes 断言适配全量写入语义 |
| `test/frontend_tests/__tests__/research-duty-field-params.test.js` | 新增 10 用例 + 2 哨兵：`researchFieldRowEffectiveFor`（自身命中/父前缀继承/整领域兜底继承/全无 null）与 `collectResearchCascadeSlots`（多层级联枚举/整域空 baseModule/叶子与空路径与空根标签返回 []/**空标签节点不出槽位但子级沿用前缀下钻**——该分支 e2e 不可达：树 PUT 对空 label 400「节点 label 不能为空」，故以纯函数单测锁定） |

## 四、接口测试结果（阶段 3）

- `test_m07_params.py -k research_duty_field`：**18 passed**（15 既有 + 3 新增，全通过）。
- `test_m07_params.py` 全量：**63 passed / 5 failed**——5 个失败均为既有 `non_admin_rejected` 基线项
  （duty-field tree/baseline/hotfix/group-template/issue-root-cause，与本改动无关，历次报告在案）。
- 关键证据：
  - `binding_cascade_write`：`PUT /binding`（module=`D/M1`，cascade_slots 含 `D/M1/M2`、`D/M1/M2/M3`）→ 200，
    GET 回读该田 scopes 含全部 3 槽位；换绑田二后槽位整体迁移、田一 scopes 清空。
  - `binding_unbind_no_cascade`：携带 cascade_slots 的解除请求 → 200 且仅自身槽位被删。
  - `binding_cascade_validations`：领域不一致/模块空/超长/超 1000 各自 400 且 detail 文案匹配；
    主槽位重复 + 列表内重复被去重不重复写入；全非法列表提交后绑定表零变化。

## 五、系统测试结果（阶段 4）

- `test/e2e/test_e2e_qi_research_field.py`：**17 passed / 0 failed**（含新增级联用例）。
- `test/e2e/test_e2e_qi_params_page.py`：**14 passed**（弹窗/参数页回归）。
- `test/test_m21_improvement_report.py`：**17 passed**（统计侧共田合并不受影响）。
- jest 全量（`test/frontend_tests`）：**798 passed / 0 failed**（较上轮 +10 = 本次新增）；
  18 个 suite 级失败为**既有存量**（ESM/node:test 风格文件被 jest 误收集，见 20260818-round2 报告在案），
  其中 `*.regression.mjs` 9 套件以 `node --test` 单独验证：**39 passed / 0 failed**。
- `test/e2e/test_qi_page_no_errors.py`（按规则单独跑）：**4 passed**。
- 关键证据（级联用例 4 步）：
  - 弹窗提示「保存后将同时为 2 个下级节点绑定该田」；落库 scopes = A1、A1/X、A1/X/Y 三槽位；
  - 解除 X 后 scopes 仅剩 A1、A1/X/Y，X 角标显示「E2E级联田一（继承）」且 class 含 `--inherited`，
    confirm 文案含「仅解除本节点，下级绑定不变」；
  - 换绑田二后 A1 子树 3 槽位整体迁移（按模块排序断言，规避绑定表 id 序不确定性）、田一清空、
    全子树角标变田二且无「继承」；
  - 整域绑定后解除 A1 仅自身 → A1 角标回退整领域槽位显示「E2E级联田一（继承）」。

## 六、测试覆盖核对（改动清单逐项）

| 改动点 | 覆盖用例 |
|---|---|
| 后端：级联槽位 upsert（INSERT/UPDATE 两分支、单事务） | m07 `binding_cascade_write`（新插入 + 覆盖既有）|
| 后端：解除仅自身（忽略 cascade_slots） | m07 `binding_unbind_no_cascade` + e2e 级联用例步骤 2/4 |
| 后端：5 条校验分支（领域不一致/模块空/超长/超量/去重） | m07 `binding_cascade_validations`（逐分支断言 400 文案与零副作用）|
| 前端：`collectResearchCascadeSlots` 多层枚举/整域/防御分支 | jest（含空标签下钻分支——e2e 不可达，树 PUT 空 label 400）+ e2e 弹窗级联数量提示 |
| 前端：`researchFieldRowEffectiveFor` 自身/父前缀/整域回退 | jest（4 分支）+ e2e 级联用例步骤 2（父前缀继承）/步骤 4（整域兜底继承） |
| 前端：角标「（继承）」后缀 + `--inherited` 样式类 + title | e2e 步骤 2/4（文本 + class 断言） |
| 前端：提交体携带 cascade_slots / 解除携带 `[]` | e2e 落库 scopes 断言（步骤 1/3） |
| 弹窗级联数量提示文案 | e2e 步骤 1 hint 断言 |
| 解除 confirm 文案 | e2e 步骤 2 dialog 消息断言 |
| `.duty-field-research-badge--inherited` 样式 | e2e class 断言（渲染生效）|
| state 新增字段 | 弹窗开/关重置（jest 哨兵 + e2e 重复打开弹窗步骤 3/4） |

**覆盖缺口：无**（阶段 4 曾识别 2 处未覆盖分支——空标签下钻、整域兜底继承——前者因树 API 拒绝空 label
无法在 e2e 造出，改由 jest 纯函数单测锁定；后者补入 e2e 级联用例步骤 4。补测过程中一次 e2e 失败
（空标签种子被树 PUT 400 拒绝）为用例设计问题而非产品缺陷，调整种子并转移覆盖方式后全绿，未触发回退）。

## 七、遗留风险与后续事项

- **级联为前端枚举**：弹窗打开时按当次树快照枚举槽位；若弹窗滞留期间他人改树，提交仍按旧快照写入
  （后端校验槽位格式但不校验其存在于树）。影响：可能写入树上已不存在的槽位——统计侧前缀匹配不受影响，
  参数页只读展示仍可见可解除。属可接受的一致性窗口。
- **跨田深度优先级**：多个田的 scope 前缀重叠时归因按绑定表顺序取首个命中（既有语义，未改动），
  级联写入会使重叠场景更常见；如需确定性优先级可后续按槽位深度排序。
- m07 的 5 个 `non_admin_rejected` 基线失败与 jest 18 个 suite 级误收集均为存量问题，历次报告在案，
  建议另行立项处理（不影响本闭环）。

---
name: xiaoluban-message-links
description: 小鲁班通知消息中的链接须拼接为完整公网 URL。在实现或修改小鲁班推送、工单/请假通知链接、build_ticket_link、build_leave_approval_link 时使用。
---

# 小鲁班通知链接

## 硬性要求

小鲁班消息正文里出现的**所有可点击链接**，必须是**完整绝对 URL**，不得仅输出相对路径（如 `/tickets/...`）。

默认公网前缀（不含尾部 `/`）：

```
https://gaussdb-ops.rnd.huawei.com
```

路径与完整链接示例：

| 场景 | 路径 | 完整链接 |
|------|------|----------|
| 工单详情 | `/tickets/{工单号}` | `https://gaussdb-ops.rnd.huawei.com/tickets/YW20260608011` |
| 请假审批/详情 | `/leave-application?id={申请ID}` | `https://gaussdb-ops.rnd.huawei.com/leave-application?id=12` |

## 实现约定

1. **统一入口**：在 `backend/utils/xiaoluban_message.py` 中通过 `build_ticket_link`、`build_leave_approval_link`（及内部 `_xiaoluban_link_base()`）生成链接，勿在路由或其它模块手写路径拼接。
2. **前缀优先级**：`APP_PUBLIC_BASE_URL`（环境变量）优先；未配置时使用 `XIAOLUBAN_LINK_BASE_URL` 默认值 `https://gaussdb-ops.rnd.huawei.com`。
3. **新增通知类型**：若消息体需附带站内页面链接，先定义路径，再经上述构建函数拼出完整 URL 后写入消息正文。
4. **测试**：断言链接为完整 URL（含 `https://` 与域名），或 patch `APP_PUBLIC_BASE_URL` 验证可覆盖默认前缀。

## 涉及文件

- `backend/utils/xiaoluban_message.py` — 链接构建与消息格式化
- `backend/config.py` — `APP_PUBLIC_BASE_URL`、`XIAOLUBAN_LINK_BASE_URL`
- `test/test_m16_ticket_notification.py` — 工单与请假通知链接测试

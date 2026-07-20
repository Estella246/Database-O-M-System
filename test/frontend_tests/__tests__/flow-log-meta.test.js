/**
 * 工单详情节点卡片：提交来源判定、meta 文案、已走过节点编辑权限。
 * 逻辑须与 ticket-page.js 中同名导出函数保持一致。
 */

function operatorMatchesPersonField(fieldValue, operator) {
  const raw = String(fieldValue || "")
    .replace(/\u3000/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!raw || !operator) return false;
  const account = String(operator.account || "").trim();
  const userName = String(operator.userName || "").trim();
  const accLower = account.toLowerCase();
  if (account && (raw === account || raw.toLowerCase() === accLower)) return true;
  if (userName && raw === userName) return true;
  const tokens = raw.split(" ").filter(Boolean);
  if (account && tokens.some((t) => t.toLowerCase() === accLower)) return true;
  if (userName && tokens.some((t) => t === userName)) return true;
  return false;
}

function collectSubmittedFromSteps(workflowLogs, opLogs) {
  const set = new Set();
  (workflowLogs || []).forEach((entry) => {
    const step = String(entry?.step || "").trim();
    if (step) set.add(step);
  });
  (opLogs || []).forEach((entry) => {
    const from = String(entry?.from || "").trim();
    if (from && from !== "-") set.add(from);
  });
  return set;
}

function hydrateWorkflowLogsFromOpLogs(orderId, opLogs, workflowByOrderId) {
  const rows = Array.isArray(opLogs) ? opLogs : [];
  if (!rows.length) return;
  const workflow = workflowByOrderId[orderId] || { currentStep: 0, logs: [] };
  if (Array.isArray(workflow.logs) && workflow.logs.length > 0) return;
  const byStep = new Map();
  rows.forEach((entry) => {
    const step = String(entry?.from || "").trim();
    if (!step || step === "-") return;
    byStep.set(step, {
      step,
      actor: String(entry?.actor || "-"),
      at: String(entry?.at || ""),
    });
  });
  if (byStep.size) workflowByOrderId[orderId] = { ...workflow, logs: [...byStep.values()] };
}

function buildLatestMetaByStep(opLogs) {
  const latestMetaByStep = new Map();
  (opLogs || []).forEach((log) => {
    const from = String(log.from || "");
    if (from) latestMetaByStep.set(from, { actor: String(log.actor || "-"), at: String(log.at || "") });
  });
  return latestMetaByStep;
}

function resolveFlowLogMetaText({ log, latestMeta, submittedFromStep }) {
  if (log) return `${log.actor} · ${log.at}`;
  if (!submittedFromStep) return "";
  if (latestMeta) return `${latestMeta.actor} · ${latestMeta.at}`;
  return "暂无记录";
}

function operatorProcessedFlowStep(step, { workflowLog, opLogs, operator } = {}) {
  const stepName = String(step || "").trim();
  if (!stepName || !operator) return false;
  const actorMatches = (actor) => operatorMatchesPersonField(String(actor || ""), operator);
  if (workflowLog && actorMatches(workflowLog.actor)) return true;
  for (const entry of opLogs || []) {
    if (!actorMatches(entry?.actor)) continue;
    const from = String(entry?.from || "").trim();
    const to = String(entry?.to || "").trim();
    if (from === stepName) return true;
    if (to === stepName) return true;
  }
  return false;
}

function resolveFlowNodeEditable({
  isCurrent,
  passedNodeLevel,
  currentStageLevel,
  nodeHandlerOk,
  selfProcessedStep,
}) {
  if (isCurrent) return currentStageLevel === "editable" || nodeHandlerOk;
  if (passedNodeLevel === "editable") return true;
  if (passedNodeLevel === "readonly" && selfProcessedStep) return true;
  return false;
}

describe("flow log meta on node tabs", () => {
  test("来源节点提交后展示处理人与时间", () => {
    const text = resolveFlowLogMetaText({
      log: { actor: "张三", at: "2026-06-17 10:00" },
      latestMeta: null,
      submittedFromStep: true,
    });
    expect(text).toBe("张三 · 2026-06-17 10:00");
  });

  test("首次抵达的目标节点不展示右上角信息", () => {
    const text = resolveFlowLogMetaText({
      log: null,
      latestMeta: { actor: "李四", at: "2026-06-17 11:00" },
      submittedFromStep: false,
    });
    expect(text).toBe("");
  });

  test("曾提交过的历史节点从操作日志还原 meta", () => {
    const text = resolveFlowLogMetaText({
      log: null,
      latestMeta: { actor: "王五", at: "2026-06-16 09:00" },
      submittedFromStep: true,
    });
    expect(text).toBe("王五 · 2026-06-16 09:00");
  });

  test("collectSubmittedFromSteps 合并 workflow.log 与操作日志 from", () => {
    const set = collectSubmittedFromSteps(
      [{ step: "问题填写" }],
      [
        { from: "问题审核", to: "运维分析" },
        { from: "运维分析", to: "开发分析" },
      ]
    );
    expect(set.has("问题填写")).toBe(true);
    expect(set.has("问题审核")).toBe(true);
    expect(set.has("运维分析")).toBe(true);
    expect(set.has("开发分析")).toBe(false);
  });

  test("latestMeta 仅取来源节点 submit/close，不取目标节点到达记录", () => {
    const meta = buildLatestMetaByStep([
      { from: "运维闭环", to: "审核关闭", actor: "运维闭环人 ops01", at: "2026-07-07 10:00" },
      { from: "审核关闭", to: "审核关闭", action: "close", actor: "关闭人 closer01", at: "2026-07-07 11:00" },
    ]);
    expect(meta.get("审核关闭")?.actor).toBe("关闭人 closer01");
    expect(meta.has("运维闭环")).toBe(true);
  });

  test("hydrateWorkflowLogsFromOpLogs 从服务端日志还原节点 actor", () => {
    const store = {};
    hydrateWorkflowLogsFromOpLogs(
      "YW001",
      [{ from: "审核关闭", to: "审核关闭", action: "close", actor: "关闭人 closer01", at: "2026-07-07 11:00" }],
      store
    );
    expect(store.YW001.logs).toHaveLength(1);
    expect(store.YW001.logs[0].actor).toBe("关闭人 closer01");
  });
});

describe("passed node edit permission", () => {
  const operator = { account: "zhangsan", userName: "张三" };

  test("readonly 策略下本人处理过的已走过节点可编辑", () => {
    const selfProcessed = operatorProcessedFlowStep("运维分析", {
      workflowLog: null,
      opLogs: [{ from: "运维分析", to: "开发分析", actor: "张三 zhangsan" }],
      operator,
    });
    expect(selfProcessed).toBe(true);
    expect(
      resolveFlowNodeEditable({
        isCurrent: false,
        passedNodeLevel: "readonly",
        currentStageLevel: "readonly",
        nodeHandlerOk: false,
        selfProcessedStep: selfProcessed,
      })
    ).toBe(true);
  });

  test("readonly 策略下他人处理过的已走过节点不可编辑", () => {
    const selfProcessed = operatorProcessedFlowStep("运维分析", {
      workflowLog: null,
      opLogs: [{ from: "运维分析", to: "开发分析", actor: "李四 lisi" }],
      operator,
    });
    expect(selfProcessed).toBe(false);
    expect(
      resolveFlowNodeEditable({
        isCurrent: false,
        passedNodeLevel: "readonly",
        currentStageLevel: "readonly",
        nodeHandlerOk: false,
        selfProcessedStep: selfProcessed,
      })
    ).toBe(false);
  });

  test("editable 策略下所有已走过节点可编辑", () => {
    expect(
      resolveFlowNodeEditable({
        isCurrent: false,
        passedNodeLevel: "editable",
        currentStageLevel: "readonly",
        nodeHandlerOk: false,
        selfProcessedStep: false,
      })
    ).toBe(true);
  });
});

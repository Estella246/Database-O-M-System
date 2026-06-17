/**
 * 工单详情节点卡片右上角：仅来源已提交节点展示处理人/时间，首次抵达的目标节点不展示。
 * 逻辑须与 ticket-page.js 中 collectSubmittedFromSteps / resolveFlowLogMetaText 保持一致。
 */

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

function resolveFlowLogMetaText({ log, latestMeta, submittedFromStep }) {
  if (log) return `${log.actor} · ${log.at}`;
  if (!submittedFromStep) return "";
  if (latestMeta) return `${latestMeta.actor} · ${latestMeta.at}`;
  return "暂无记录";
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
});

/**
 * 与 frontend/modules/pages/export-modal.js 中 resolveSelectedExportTickets 逻辑一致。
 */
function resolveSelectedExportTickets(visibleTickets, selectedTicketIds) {
  const selectedSet = new Set(selectedTicketIds);
  const fromVisible = visibleTickets.filter((t) => selectedSet.has(t.orderId));
  const foundIds = new Set(fromVisible.map((t) => t.orderId));
  const stubs = selectedTicketIds
    .filter((id) => !foundIds.has(id))
    .map((id) => ({ orderId: id, processId: id }));
  return [...fromVisible, ...stubs];
}

describe("resolveSelectedExportTickets", () => {
  test("当前页仅含部分选中工单时仍导出全部选中单号", () => {
    const visibleTickets = [
      { orderId: "YW20260101001", processId: "YW20260101001" },
      { orderId: "YW20260101002", processId: "YW20260101002" },
    ];
    const selected = ["YW20260101001", "YW20260101002", "YW20260101003", "YW20260101004"];
    const result = resolveSelectedExportTickets(visibleTickets, selected);
    expect(result.map((t) => t.orderId)).toEqual(selected);
    expect(result[0].currentStage).toBeUndefined();
    expect(result[2]).toEqual({ orderId: "YW20260101003", processId: "YW20260101003" });
  });

  test("可见列表已含全部选中工单时保留完整行数据", () => {
    const visibleTickets = [
      { orderId: "YW20260101001", processId: "YW20260101001", currentStage: "运维分析" },
      { orderId: "YW20260101002", processId: "YW20260101002", currentStage: "开发分析" },
    ];
    const selected = ["YW20260101001", "YW20260101002"];
    const result = resolveSelectedExportTickets(visibleTickets, selected);
    expect(result).toEqual(visibleTickets);
  });
});

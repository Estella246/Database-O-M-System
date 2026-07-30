/**
 * 责任田二级模块负责人解析（与 normalize.js 一致，供开发闭环默认下一步处理人使用）。
 */

function splitDutyFieldCascadePath(raw) {
  return String(raw || "")
    .split(/\s*\/\s*/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function resolveDutyFieldL2OwnerFromCascade(cascadeOptions, modulePath) {
  const parts = splitDutyFieldCascadePath(modulePath);
  if (parts.length < 2) return "";
  const [l1, l2] = parts;
  const roots = Array.isArray(cascadeOptions) ? cascadeOptions : [];
  const l1Node = roots.find((n) => String(n?.label || "").trim() === l1);
  if (!l1Node) return "";
  const kids = Array.isArray(l1Node.children) ? l1Node.children : [];
  const l2Node = kids.find((n) => String(n?.label || "").trim() === l2);
  return String(l2Node?.owner || "").trim();
}

describe("resolveDutyFieldL2OwnerFromCascade", () => {
  const tree = [
    {
      label: "存储引擎",
      children: [
        {
          label: "段页管理",
          owner: "张三 zhangsan",
          children: [{ label: "空闲空间管理", children: [] }],
        },
        { label: "块存储", children: [{ label: "事务", children: [] }] },
      ],
    },
  ];

  test("取二级模块负责人", () => {
    expect(resolveDutyFieldL2OwnerFromCascade(tree, "存储引擎/段页管理/空闲空间管理")).toBe(
      "张三 zhangsan"
    );
  });

  test("二级无负责人时返回空", () => {
    expect(resolveDutyFieldL2OwnerFromCascade(tree, "存储引擎/块存储/事务")).toBe("");
  });

  test("路径不足两级或树为空时返回空", () => {
    expect(resolveDutyFieldL2OwnerFromCascade(tree, "存储引擎")).toBe("");
    expect(resolveDutyFieldL2OwnerFromCascade([], "存储引擎/段页管理")).toBe("");
  });
});

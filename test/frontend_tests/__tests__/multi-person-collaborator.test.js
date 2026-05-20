import {
  parseMultiPersonValue,
  joinMultiPersonValue,
  isMultiPersonWhitelistField,
  MULTI_PERSON_DELIMITER,
  DEV_ANALYSIS_MULTI_COLLABORATOR,
} from "../../../frontend/modules/constants/workflow.js";

describe("协同处理人多选存读", () => {
  test("parse / join 使用全角分号", () => {
    const joined = joinMultiPersonValue(["张三 l30030745", "李四 l30030746"]);
    expect(joined).toBe(`张三 l30030745${MULTI_PERSON_DELIMITER}李四 l30030746`);
    expect(parseMultiPersonValue(joined)).toEqual(["张三 l30030745", "李四 l30030746"]);
  });

  test("单人历史值无分隔符仍可解析", () => {
    expect(parseMultiPersonValue("张三 l30030745")).toEqual(["张三 l30030745"]);
  });

  test("join 去重", () => {
    expect(joinMultiPersonValue(["张三 l30030745", "张三 l30030745"])).toBe("张三 l30030745");
  });

  test("开发分析协同处理人固定多选", () => {
    expect(
      isMultiPersonWhitelistField(
        { type: "whitelist", key: DEV_ANALYSIS_MULTI_COLLABORATOR.fieldKey },
        DEV_ANALYSIS_MULTI_COLLABORATOR.nodeKey
      )
    ).toBe(true);
  });

  test("ui_props.multiple 启用多选字段", () => {
    expect(isMultiPersonWhitelistField({ type: "whitelist", ui_props: { multiple: true } })).toBe(true);
    expect(isMultiPersonWhitelistField({ type: "whitelist", key: "collaborator" }, "ops_closure")).toBe(false);
  });
});

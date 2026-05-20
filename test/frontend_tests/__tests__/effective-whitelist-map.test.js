import { buildEffectiveWhitelistMap } from "../../../frontend/modules/utils/normalize.js";

describe("buildEffectiveWhitelistMap", () => {
  const perms = [
    { role_code: "dev", is_pl: false, node_key: "__whitelist__", field_key: "workbench_delete", permission_level: "readonly" },
    { role_code: "dev", is_pl: true, node_key: "__whitelist__", field_key: "ticket_list", permission_level: "editable" },
  ];

  test("非 PL 用户仅读 is_pl=false 行", () => {
    const wl = buildEffectiveWhitelistMap(perms, "dev", false);
    expect(wl.workbench_delete).toBe("readonly");
    expect(wl.ticket_list).toBeUndefined();
  });

  test("PL 用户回落 is_pl=false 并覆盖 is_pl=true", () => {
    const wl = buildEffectiveWhitelistMap(perms, "dev", true);
    expect(wl.workbench_delete).toBe("readonly");
    expect(wl.ticket_list).toBe("editable");
  });
});

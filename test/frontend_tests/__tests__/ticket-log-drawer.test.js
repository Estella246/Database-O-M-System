import { positionTicketLogDrawer } from "../../../frontend/modules/ui/ticket-log-drawer.js";

describe("positionTicketLogDrawer", () => {
  test("uses detail-workspace bounds when present", () => {
    const workspace = document.createElement("div");
    workspace.className = "detail-workspace";
    document.body.appendChild(workspace);
    jest.spyOn(workspace, "getBoundingClientRect").mockReturnValue({
      top: 80,
      bottom: 680,
      left: 100,
      right: 900,
      width: 800,
      height: 600,
    });

    const drawer = document.createElement("aside");
    document.body.appendChild(drawer);

    positionTicketLogDrawer(drawer);

    expect(drawer.style.position).toBe("fixed");
    expect(drawer.style.right).toBe("0px");
    expect(drawer.style.top).toBe("80px");
    expect(drawer.style.height).toBe("600px");
    expect(drawer.style.zIndex).toBe("10060");

    workspace.remove();
    drawer.remove();
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { routeIntent } from "../../ai/intent.ts";
import { isWritablePath } from "../../ai/paths.ts";

describe("INT-01 project query", () => {
  it("why only N is PROJECT_QUERY", () => {
    const r = routeIntent("Почему только 24?");
    assert.equal(r.scope, "PROJECT");
    assert.equal(r.type, "PROJECT_QUERY");
  });
});

describe("INT-02 application edit", () => {
  it("collapsible chat is APPLICATION_EDIT", () => {
    const r = routeIntent("Сделай чат сворачиваемым.");
    assert.equal(r.scope, "APPLICATION");
    assert.equal(r.type, "APPLICATION_EDIT");
  });
});

describe("INT-03 reality", () => {
  it("photos route to REALITY", () => {
    const r = routeIntent("Вот реальные фотографии помещения.", { hasPhotos: true });
    assert.equal(r.scope, "REALITY");
  });
});

describe("INT-04 engineering core files are not writable", () => {
  it("blocks engineering and equipment", () => {
    assert.equal(isWritablePath("src/engineering/pipeline.ts"), false);
    assert.equal(isWritablePath("src/equipment/asic-catalog.ts"), false);
    assert.equal(isWritablePath("src/components/app/TopBar.tsx"), true);
    assert.equal(isWritablePath("../etc/passwd"), false);
  });
});

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createSaveScheduler, type PersistUi } from "../../project/save-scheduler.ts";
import { emptyRectangularProject } from "../../project/factory.ts";
import { parseProject } from "../../project/schema.ts";
import { geometryFingerprint } from "../reality.ts";

function tick(ms = 0): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe("PERSIST-01 successful save: saving → saved", () => {
  it("transitions saving then saved", async () => {
    const ui: PersistUi = { saveState: "idle", saveError: null };
    const sched = createSaveScheduler({
      debounceMs: 0,
      save: async () => undefined,
    });
    sched.schedule(emptyRectangularProject(), (s) => Object.assign(ui, s));
    assert.equal(ui.saveState, "saving");
    await tick(5);
    assert.equal(ui.saveState, "saved");
    assert.equal(ui.saveError, null);
  });
});

describe("PERSIST-02 forced rejection: saving → error", () => {
  it("does not report saved", async () => {
    const ui: PersistUi = { saveState: "idle", saveError: null };
    const sched = createSaveScheduler({
      debounceMs: 0,
      save: async () => {
        throw new Error("idb denied");
      },
    });
    sched.schedule(emptyRectangularProject(), (s) => Object.assign(ui, s));
    assert.equal(ui.saveState, "saving");
    await tick(5);
    assert.equal(ui.saveState, "error");
    assert.ok(ui.saveError);
    assert.notEqual(ui.saveState, "saved");
    assert.notEqual(ui.saveState, "idle");
  });
});

describe("PERSIST-05 Retry: error → saving → saved", () => {
  it("retry after failure succeeds", async () => {
    let fail = true;
    const ui: PersistUi = { saveState: "idle", saveError: null };
    const sched = createSaveScheduler({
      debounceMs: 0,
      save: async () => {
        if (fail) throw new Error("fail");
      },
    });
    const p = emptyRectangularProject();
    sched.schedule(p, (s) => Object.assign(ui, s));
    await tick(5);
    assert.equal(ui.saveState, "error");
    fail = false;
    sched.retry((s) => Object.assign(ui, s));
    assert.equal(ui.saveState, "saving");
    await tick(5);
    assert.equal(ui.saveState, "saved");
  });
});

describe("PERSIST-06 save fingerprint is the project that was persisted", () => {
  it("saved payload fingerprint equals committed project after reload parse", async () => {
    let stored = "";
    const p = emptyRectangularProject({ widthM: 7.51, depthM: 5 });
    const sched = createSaveScheduler({
      debounceMs: 0,
      save: async (proj) => {
        stored = geometryFingerprint(proj);
      },
    });
    const ui: PersistUi = { saveState: "idle", saveError: null };
    sched.schedule(p, (s) => Object.assign(ui, s));
    await tick(5);
    assert.equal(ui.saveState, "saved");
    assert.equal(stored, geometryFingerprint(p));
    const reloaded = parseProject(JSON.parse(JSON.stringify(p)));
    assert.equal(geometryFingerprint(reloaded), stored);
  });
});

describe("PERSIST-07 stale save cannot mark a newer unsaved project as saved", () => {
  it("save A completing after B is scheduled does not set saved", async () => {
    let resolveA: () => void = () => undefined;
    let resolveB: () => void = () => undefined;
    const aGate = new Promise<void>((r) => {
      resolveA = r;
    });
    const bGate = new Promise<void>((r) => {
      resolveB = r;
    });
    let n = 0;
    const ui: PersistUi = { saveState: "idle", saveError: null };
    const sched = createSaveScheduler({
      debounceMs: 0,
      save: async () => {
        n += 1;
        if (n === 1) return aGate;
        return bGate;
      },
    });
    const a = emptyRectangularProject({ name: "A" });
    const b = emptyRectangularProject({ name: "B", widthM: 9 });
    sched.schedule(a, (s) => Object.assign(ui, s));
    await tick(5);
    assert.equal(ui.saveState, "saving");
    sched.schedule(b, (s) => Object.assign(ui, s));
    assert.equal(ui.saveState, "saving");
    resolveA();
    await tick(5);
    assert.equal(ui.saveState, "saving");
    resolveB();
    await tick(5);
    assert.equal(ui.saveState, "saved");
    assert.equal(sched.last()?.name, "B");
  });
});

describe("PERSIST-08 B failure after A success ends in error", () => {
  it("never restores stale saved", async () => {
    let n = 0;
    const ui: PersistUi = { saveState: "idle", saveError: null };
    const sched = createSaveScheduler({
      debounceMs: 0,
      save: async () => {
        n += 1;
        if (n === 2) throw new Error("B fail");
      },
    });
    sched.schedule(emptyRectangularProject({ name: "A" }), (s) => Object.assign(ui, s));
    await tick(5);
    assert.equal(ui.saveState, "saved");
    sched.schedule(emptyRectangularProject({ name: "B", widthM: 9 }), (s) => Object.assign(ui, s));
    await tick(5);
    assert.equal(ui.saveState, "error");
    assert.notEqual(ui.saveState, "saved");
  });
});

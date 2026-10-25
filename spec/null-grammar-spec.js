const path = require("node:path");

const { Disposable } = require("lumine");

describe("marker providers with no grammar", () => {
  let editor, main, handle, lease;
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
    jasmine.attachToDOM(lumine.workspace.getElement());
    main = (await lumine.packages.activatePackage(path.join(__dirname, ".."))).mainModule;
    editor = await lumine.workspace.open();
    editor.setGrammar(lumine.grammars.nullGrammar);
    handle = main.provideMarkerRegistry().attach(editor);
  });
  afterEach(() => {
    lease?.dispose();
    handle?.dispose();
    editor?.destroy();
  });

  it("does not initialize providers, retires their work and restores them on resume", () => {
    const cleanup = jasmine.createSpy("cleanup");
    const initialize = jasmine.createSpy("initialize").and.callFake((layer) => {
      layer.disposables.add(new Disposable(cleanup));
    });
    const getItems = jasmine.createSpy("getItems").and.returnValue([{ row: 0 }]);
    lease = main.consumeMarkerLayer({ name: "null-regression", initialize, getItems });
    handle.updateSync();
    expect(initialize).not.toHaveBeenCalled();
    expect(getItems).not.toHaveBeenCalled();
    const grammar = lumine.grammars.grammarForScopeName("text.plain");
    editor.setGrammar(grammar);
    handle.updateSync();
    expect(initialize).toHaveBeenCalledTimes(1);
    const layer = handle.layerFor("null-regression");
    expect(layer.items).toEqual([{ row: 0 }]);
    editor.setGrammar(lumine.grammars.nullGrammar);
    expect(cleanup).toHaveBeenCalledTimes(1);
    expect(layer.destroyed).toBe(true);
    expect([...handle.layers()]).toEqual([]);
    getItems.calls.reset();
    handle.updateSync();
    expect(getItems).not.toHaveBeenCalled();
    editor.setGrammar(grammar);
    expect(initialize).toHaveBeenCalledTimes(2);
    expect(handle.layerFor("null-regression")).not.toBe(layer);
  });
});

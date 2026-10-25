describe("marker update scheduling", () => {
  // Processing fixtures use a real grammar; None deliberately disables this package.
  beforeEach(async () => {
    await lumine.packages.activatePackage("language-text");
  });

  let mainModule, service, editor, handles, reads;

  function drainReads({ includeCancelled = false } = {}) {
    while (reads.length > 0) {
      const read = reads.shift();
      if (!read.cancelled || includeCancelled) read.callback();
    }
  }

  function attach() {
    const handle = service.attach(editor);
    handles.push(handle);
    return handle;
  }

  beforeEach(async () => {
    const workspaceElement = lumine.views.getView(lumine.workspace);
    workspaceElement.style.width = "800px";
    workspaceElement.style.height = "600px";
    jasmine.attachToDOM(workspaceElement);
    const pack = await lumine.packages.activatePackage("marker");
    mainModule = pack.mainModule;
    service = mainModule.provideMarkerRegistry();
    editor = await lumine.workspace.open();
    editor.setText(Array.from({ length: 50 }, (_, row) => `line ${row}`).join("\n"));
    handles = [];
    reads = [];

    // Drive the document scheduler directly: these assertions must succeed
    // without paying a timer interval before the next frame can read items.
    const { Disposable } = require("lumine");
    spyOn(lumine.views, "readDocument").and.callFake((callback) => {
      const read = { callback, cancelled: false };
      reads.push(read);
      return new Disposable(() => {
        read.cancelled = true;
      });
    });
  });

  afterEach(() => {
    for (const handle of handles) handle.dispose();
  });

  it("reads the newest cursor position in the next document frame", () => {
    lumine.config.set("marker.cursors.showAll", false);
    lumine.config.set("marker.cursors.showSelections", false);
    const handle = attach();
    handle.updateSync();
    drainReads();
    const layer = handle.layerFor("cursors");
    const getItems = spyOn(layer.props, "getItems").and.callThrough();

    editor.setCursorScreenPosition([3, 0]);
    editor.setCursorScreenPosition([9, 0]);
    expect(getItems).not.toHaveBeenCalled();

    drainReads();

    expect(getItems).toHaveBeenCalledTimes(1);
    expect(layer.items).toEqual([{ row: 9 }]);
  });

  describe("provider updates", () => {
    beforeEach(() => mainModule.cursors.destroy());

    function makeLayer() {
      let row = 0;
      const getItems = jasmine.createSpy("getItems").and.callFake(() => [{ row }]);
      mainModule.consumeMarkerLayer({ name: "a", getItems });
      const handle = attach();
      handle.updateSync();
      drainReads();
      getItems.calls.reset();
      lumine.views.readDocument.calls.reset();
      return { handle, layer: handle.layerFor("a"), getItems, move: (next) => (row = next) };
    }

    it("coalesces a burst into one frame and reads its latest data", () => {
      const { layer, getItems, move } = makeLayer();

      move(2);
      layer.update();
      move(6);
      layer.update();
      move(12);
      layer.update();

      expect(getItems).not.toHaveBeenCalled();
      expect(lumine.views.readDocument).toHaveBeenCalledTimes(1);
      drainReads();
      expect(getItems).toHaveBeenCalledTimes(1);
      expect(layer.items).toEqual([{ row: 12 }]);
    });

    it("keeps progressing on consecutive frames during continuous updates", () => {
      const { layer, getItems, move } = makeLayer();

      for (const row of [2, 4, 6]) {
        move(row - 1);
        layer.update();
        move(row);
        layer.update();
        drainReads();
        expect(layer.items).toEqual([{ row }]);
      }

      expect(getItems).toHaveBeenCalledTimes(3);
      expect(lumine.views.readDocument).toHaveBeenCalledTimes(3);
    });

    for (const order of ["layer first", "editor first"]) {
      it(`merges pending layer and full-editor work with the ${order}`, () => {
        const { handle, layer, getItems } = makeLayer();
        const otherItems = jasmine.createSpy("otherItems").and.returnValue([{ row: 8 }]);
        mainModule.consumeMarkerLayer({ name: "b", getItems: otherItems });
        handle.updateSync();
        drainReads();
        getItems.calls.reset();
        otherItems.calls.reset();
        lumine.views.readDocument.calls.reset();

        if (order === "layer first") layer.update();
        handle.update();
        layer.update();
        handle.update();

        expect(getItems).not.toHaveBeenCalled();
        expect(otherItems).not.toHaveBeenCalled();
        expect(lumine.views.readDocument).toHaveBeenCalledTimes(1);
        drainReads();
        expect(getItems).toHaveBeenCalledTimes(1);
        expect(otherItems).toHaveBeenCalledTimes(1);
      });
    }

    it("cancels a queued layer recompute when it is updated synchronously", () => {
      const { layer, getItems, move } = makeLayer();

      move(7);
      layer.update();
      layer.updateSync();
      expect(layer.items).toEqual([{ row: 7 }]);
      drainReads();

      expect(getItems).toHaveBeenCalledTimes(1);
    });

    it("cancels queued layer and editor recomputes after a synchronous editor update", () => {
      const { handle, layer, getItems, move } = makeLayer();

      move(11);
      layer.update();
      handle.update();
      handle.updateSync();
      expect(layer.items).toEqual([{ row: 11 }]);
      drainReads();

      expect(getItems).toHaveBeenCalledTimes(1);
    });

    it("leaves queued callbacks and stale handles inert after releasing the editor", () => {
      const { handle, layer, getItems } = makeLayer();
      const otherItems = jasmine.createSpy("otherItems").and.returnValue([{ row: 8 }]);
      mainModule.consumeMarkerLayer({ name: "b", getItems: otherItems });
      const other = handle.layerFor("b");
      other.update();
      layer.update();
      handle.update();

      handle.dispose();
      layer.update();
      layer.updateSync();
      other.update();
      handle.update();
      handle.updateSync();
      // Even a callback copied before cancellation must not resurrect its set.
      drainReads({ includeCancelled: true });

      expect(getItems).not.toHaveBeenCalled();
      expect(otherItems).not.toHaveBeenCalled();
      expect(layer.items).toEqual([]);
      expect([...handle.layers()]).toEqual([]);
    });
  });
});

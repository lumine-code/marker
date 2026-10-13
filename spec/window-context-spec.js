describe("marker layers in editor windows", () => {
  beforeEach(async () => {
    jasmine.useRealClock();
    jasmine.attachToDOM(lumine.workspace.getElement());
    await lumine.packages.activatePackage("marker");
  });
  afterEach(async () => {
    await lumine.packages.deactivatePackage("marker");
    await lumine.workspace.discardEditorWindows();
  });
  it("hosts independent layer pickers and scales a canvas for its auxiliary monitor", async () => {
    const workspace = lumine.workspace;
    const first = await workspace.open();
    const extra = await workspace.openEditorWindow({ show: false });
    const second = workspace.buildTextEditor();
    extra.getEditorContainer().getActivePane().activateItem(second, { activatePane: true });
    await lumine.commands.dispatch(first.getElement(), "marker:toggle-focus");
    await lumine.commands.dispatch(second.getElement(), "marker:toggle-focus");
    const main = lumine.packages.getActivePackage("marker").mainModule;
    const local = main.pickers.get(workspace.getMainWindow()).picker;
    const remote = main.pickers.get(extra).picker;
    expect(local.selectListHost.isVisible()).toBe(true);
    expect(remote.selectList.getElement().ownerDocument).toBe(extra.getDocument());
    await local.selectList.setQuery("local");
    await remote.selectList.setQuery("remote");
    expect(local.selectList.getQuery()).toBe("local");
    const canvas = extra.getDocument().createElement("canvas");
    spyOnProperty(extra.getDocument().defaultView, "devicePixelRatio", "get").and.returnValue(2);
    main.provideMarkerRegistry().resizeCanvas(canvas, 10, 20);
    expect(canvas.width).toBe(20);
    expect(canvas.height).toBe(40);
    await workspace.attachWindow(extra);
    expect(main.pickers.has(extra)).toBe(false);
  });
});

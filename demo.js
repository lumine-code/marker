// Authentic package usage. Run with lumine/script/demo.js; fixtures stay in demo/.
module.exports = {
  version: 1,
  dependencies: ["language-javascript", "tree-view", "bookmarks", "highlight-selected"],
  viewport: { width: 1200, height: 760 },
  async before() {},
  async prepare(context) {
    const { lumine, state, fixture, open } = context;
    state.editor = await open("Signal Lab/src/signal.js");
    await lumine.project.setPaths([fixture("Signal Lab")]);
  },
  scenes: [
    {
      id: "scene-1",
      file: "demo.png",
      caption: "Manage visible marker layers for editor annotations.",
      timeout: 60000,
      async run(context) {
        const { lumine, state } = context;
        {
          lumine.commands.dispatch(lumine.views.getView(state.editor), "tree-view:show");
          await new Promise((resolve) => setTimeout(resolve, 600));
        }
        {
          lumine.packages.getActivePackage("marker").mainModule.toggleFocus();
          await lumine.packages.getActivePackage("marker").mainModule.picker.selectListHost.show();
        }
      },
      ready(context) {
        const { lumine } = context;
        return Boolean(
          lumine.packages.getActivePackage("marker").mainModule.picker.selectListHost.isVisible() &&
          document.querySelector(".marker-view")?.getBoundingClientRect().height > 50,
        );
      },
    },
  ],
  async cleanup() {},
};

import { createApp, h } from "vue";
import { NConfigProvider, NDialogProvider } from "naive-ui";
import App from "./App.vue";
import { equipSheetThemeOverrides } from "./naive-theme.js";
import "./styles.css";

const app = createApp({
  name: "Root",
  render() {
    return h(NConfigProvider, { themeOverrides: equipSheetThemeOverrides }, {
      default: () => h(NDialogProvider, null, { default: () => h(App) }),
    });
  },
});

app.mount("#app");

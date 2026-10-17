/**
 * UI entry point (runs in the plugin iframe).
 */

import "../style.css";
import "./styles/shell.css";
import "./styles/editor.css";
import "./styles/panels.css";
import { render } from "preact";
import { App } from "./App";
import { applyInitialTheme, listenToPlugin, sendToPlugin } from "./bridge";

applyInitialTheme();
listenToPlugin();
render(<App />, document.getElementById("app")!);
sendToPlugin({ type: "init" });

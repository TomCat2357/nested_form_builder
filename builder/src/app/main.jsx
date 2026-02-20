import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./theme/theme.css";
import "./theme/themes/standard.css";
import "./theme/themes/matcha.css";
import "./theme/themes/sakura.css";
import "./theme/themes/warm.css";
import "./theme/base.css";
import "./theme/preview-overrides.css";
import { DEFAULT_THEME, initTheme } from "./theme/theme.js";

initTheme(DEFAULT_THEME);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

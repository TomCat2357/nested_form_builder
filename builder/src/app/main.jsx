import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./theme/theme.css";
import "./theme/base.css";
import "./theme/preview-overrides.css";

// themesフォルダ内のすべてのCSSを自動的に読み込む
import.meta.glob('./theme/themes/*.css', { eager: true });
import { DEFAULT_THEME, initTheme } from "./theme/theme.js";
import { applyInitialHashFromGas } from "../utils/appUrl.js";

initTheme(DEFAULT_THEME);
// HashRouter マウント前に doGet が ?route= から注入した __INITIAL_HASH__ を反映する
// (iframe にハッシュが伝わらないため、Question 編集等の新タブ遷移を成立させる)
applyInitialHashFromGas();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

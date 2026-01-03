import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import "./theme/themes/balanced.css";
import "./theme/system.css";
import { initTheme } from "./theme/theme.js";

initTheme("balanced");

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

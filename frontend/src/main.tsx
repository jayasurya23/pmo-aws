import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, HashRouter } from "react-router-dom";
import App from "./App";
import { STATIC } from "./lib/api";
import "./styles/index.css";

// Theme: an explicit choice wins; otherwise follow the OS.
try {
  const saved = localStorage.getItem("pmo-demo-theme");
  const dark = saved ? saved === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
} catch {
  /* storage unavailable: default light */
}

// Hash routing in the static build so deep links work on any static host.
const Router = STATIC ? HashRouter : BrowserRouter;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Router>
      <App />
    </Router>
  </React.StrictMode>,
);

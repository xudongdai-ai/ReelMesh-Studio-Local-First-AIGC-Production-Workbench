import React from "react";
import { createRoot } from "react-dom/client";
import { AdminPortal } from "./AdminPortal.jsx";
import "../styles.css";
import { clearLegacyPrototypeData } from "../shared/storage.js";

clearLegacyPrototypeData();

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <AdminPortal />
  </React.StrictMode>,
);

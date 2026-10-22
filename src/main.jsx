import React from "react";
import ReactDOM from "react-dom/client";
import FlowbaseScreen from "./flowbase/ui/FlowbaseScreen.tsx";
import RecorderPill from "./flowbase/ui/RecorderPill.tsx";
import "./flowbase/ui/flowbase.css";

// Zwei Fenster laden dieselbe Seite: ohne Query = Flowbase-Bildschirm, ?pill=1 = Aufnahme-Pille.
const isPill = new URLSearchParams(window.location.search).get("pill") === "1";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>{isPill ? <RecorderPill /> : <FlowbaseScreen />}</React.StrictMode>
);

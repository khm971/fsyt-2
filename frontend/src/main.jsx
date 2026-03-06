import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueueWebSocketProvider } from "./context/QueueWebSocketContext";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <QueueWebSocketProvider>
      <App />
    </QueueWebSocketProvider>
  </StrictMode>
);

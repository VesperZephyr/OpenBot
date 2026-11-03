import "./ui/layers.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./ui/openbot.css";
import "./styles.css";
import "./details.css";

const root = document.getElementById("root");
if (root === null) throw new Error("Missing #root element");
createRoot(root).render(
	<StrictMode>
		<App />
	</StrictMode>,
);

import "./conversation.css";

import "./chat-experience.css";
import "./boardui-conversation.css";

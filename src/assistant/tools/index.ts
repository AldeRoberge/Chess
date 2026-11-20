import type { AgentTool } from "../agent";
import type { AssistantHost } from "../host";
import { appTools } from "./app";
import { configureTools } from "./configure";
import { inspectTools } from "./inspect";
import { liveTools } from "./live";
import { tableTools } from "./table";
import { graphTools } from "./graph";
import { chessTools } from "./chess";
import { uiTools } from "./ui";

export { nodeTypes } from "./inspect";
export { commitSetup } from "./configure";

/** Every tool the assistant has, in the order the model sees them. */
export const buildTools = (h: AssistantHost): AgentTool[] => [...inspectTools(h), ...chessTools(h), ...uiTools(h), ...graphTools(h), ...configureTools(h), ...appTools(h), ...tableTools(h), ...liveTools(h)];

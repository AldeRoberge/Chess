import type { AgentTool } from "../agent";
import type { AssistantHost } from "../host";
import { appTools } from "./app";
import { configureTools } from "./configure";
import { inspectTools } from "./inspect";
import { liveTools } from "./live";
import { tableTools } from "./table";

export { nodeTypes } from "./inspect";
export { commitSetup } from "./configure";

/** Every tool the assistant has, in the order the model sees them. */
export const buildTools = (h: AssistantHost): AgentTool[] => [...inspectTools(h), ...configureTools(h), ...appTools(h), ...tableTools(h), ...liveTools(h)];

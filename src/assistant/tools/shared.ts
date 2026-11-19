import type { AgentTool } from "../agent";
import type { AssistantHost } from "../host";

export { SECRET } from "../host";
/** A group of related tools, built against the host. */
export type ToolGroup = (h: AssistantHost) => AgentTool[];

/** JSON-schema helpers: every tool takes a closed object. */
export const obj = (properties: Record<string, unknown>, required: string[] = []) => ({ type: "object", properties, required, additionalProperties: false });
export const str = (description: string, extra: Record<string, unknown> = {}) => ({ type: "string", description, ...extra });

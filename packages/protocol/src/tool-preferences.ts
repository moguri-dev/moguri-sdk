import { Type, type Static } from "typebox";

export const ToolMethodSchema = Type.Union([
  Type.Literal("mcp-gateway"), Type.Literal("mcp-direct"), Type.Literal("rest"), Type.Literal("cli"),
]);
export type ToolMethod = Static<typeof ToolMethodSchema>;
export const ToolPreferencesSchema = Type.Object({
  order: Type.Array(ToolMethodSchema, { minItems: 4, maxItems: 4, uniqueItems: true }),
}, { additionalProperties: false });
export type ToolPreferences = Static<typeof ToolPreferencesSchema>;
export const toolMethods: readonly { id: ToolMethod; name: string; description: string }[] = [
  { id: "mcp-gateway", name: "MCP via Gateway", description: "Discover and call exact approved MCP tools through the shared gateway." },
  { id: "mcp-direct", name: "MCP direct", description: "Use a discovered MCP tool's own typed model schema, with the same service-owned permissions." },
  { id: "rest", name: "REST API", description: "Use an available, explicitly scoped API integration without borrowing another account." },
  { id: "cli", name: "CLI", description: "Use an installed command-line client on the actual execution host; never install or authenticate implicitly." },
];
export const defaultToolPreferences = (): ToolPreferences => ({ order: toolMethods.map((method) => method.id) });
export const effectiveToolPreferences = (preferences?: ToolPreferences): ToolPreferences => preferences ?? defaultToolPreferences();
export function toolPreferenceGuidance(preferences?: ToolPreferences): string {
  const { order } = effectiveToolPreferences(preferences);
  return `\n<tool-method-preference>
For equivalent available external integrations, prefer:
${order.map((id, index) => `${index + 1}. ${toolMethods.find((method) => method.id === id)!.name}`).join("\n")}
Keep exact-root built-in workflows. Ranking is not permission or availability; skip unavailable methods without installing/authenticating or changing account/Env. MCP direct keeps gateway server/schema/root approvals. Never retry an uncertain write through another method: inspect its original receipt/effects.
</tool-method-preference>`;
}

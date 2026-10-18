/** Runtime validators stay outside the pure descriptor module used by the renderer. */
import { Compile } from "typebox/compile";
import { APP_CAPABILITIES, type AppCapabilityId } from "./app-capabilities.ts";

const inputs = new Map(APP_CAPABILITIES.map(d => [d.id, Compile(d.inputSchema)]));
const outputs = new Map(APP_CAPABILITIES.map(d => [d.id, Compile(d.outputSchema)]));
export const validAppInput = (id: AppCapabilityId, value: unknown): boolean => inputs.get(id)!.Check(value);
export const validAppOutput = (id: AppCapabilityId, value: unknown): boolean => outputs.get(id)!.Check(value);

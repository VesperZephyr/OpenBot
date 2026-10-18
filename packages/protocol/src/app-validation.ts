/** Runtime validators stay outside the pure descriptor module used by the renderer. */
import { Compile } from "typebox/compile";
import { APP_CAPABILITIES, type AppCapabilityId } from "./app-capabilities.ts";

const inputs = new Map(APP_CAPABILITIES.map(d => [d.id, Compile(d.inputSchema)]));
const outputs = new Map(APP_CAPABILITIES.map(d => [d.id, Compile(d.outputSchema)]));
export const validAppInput = (id: AppCapabilityId, value: unknown): boolean => inputs.get(id)!.Check(value);
export const validAppOutput = (id: AppCapabilityId, value: unknown): boolean => outputs.get(id)!.Check(value);

import { APP_MANAGEMENT_CAPABILITIES } from "./app-management.ts";
const managementInputs = new Map(APP_MANAGEMENT_CAPABILITIES.map(d => [d.id, Compile(d.inputSchema)]));
const managementOutputs = new Map(APP_MANAGEMENT_CAPABILITIES.map(d => [d.id, Compile(d.outputSchema)]));
export const validManagementInput = (id: string, value: unknown) => managementInputs.get(id)?.Check(value) === true;
export const validManagementOutput = (id: string, value: unknown) => managementOutputs.get(id)?.Check(value) === true;

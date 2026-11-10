/**
 * Versioned OpenBot data contracts shared by Desktop, the Host Runtime, and executors.
 * This package contains types, parameter schemas, and pure helpers only: no Pi, Electron, or Node dependencies. Its one
 * dependency is TypeBox, for the runtime schemas in `schemas.ts`.
 */

export * from "./local-tasks.ts";
export * from "./executor-errors.ts";
export * from "./memory-read.ts";
export type { ActivityLabel, ExecutionObservation } from "./activity.ts";
export * from "./templates.ts";
export { historyPartition } from "./history.ts";
export type { TimelinePosition, TimelineRow, TimelineWindow, WindowInput, WindowResult, DetailInput, DetailResult, IndexStatus } from "./history.ts";
export * from "./avatars.ts";
export * from "./routines.ts";
export { ROUTINE_PROPOSAL_FIELDS, validRoutineProposalFields } from "./routine-schemas.ts";
export * from "./memory.ts";
export * from "./credentials.ts";
export * from "./connectors.ts";
export * from "./background.ts";
export * from "./skills.ts";
export type { LifecycleState, NativeLifecycle, LifecycleReason, LifecycleRecord } from "./lifecycle.ts";
export * from "./app-management.ts";
export * from "./app-execution.ts";
export * from "./app-capabilities.ts";
export * from "./errors.ts";
export * from "./target.ts";
export * from "./version.ts";
export * from "./models.ts";
export * from "./bots.ts";
export * from "./conversations.ts";
export * from "./groups.ts";
export * from "./runs.ts";
export * from "./usage.ts";
export * from "./policy.ts";
export * from "./approvals.ts";
export * from "./settings.ts";
export * from "./host-methods.ts";
export * from "./host-events.ts";
export * from "./envelopes.ts";
export * from "./executor.ts";
export * from "./tools.ts";
export { ARTIFACT_LIMITS } from "./artifacts.ts";
export type { ArtifactRef, ArtifactContent, ArtifactOperation, ArtifactOperationResult, ArtifactListing } from "./artifacts.ts";
export { READER_LIMITS } from "./reader.ts";
export type { ReaderFile, FileListing, FileEntry } from "./reader.ts";
export type { BackupRequest, BackupResult } from "./backup.ts";

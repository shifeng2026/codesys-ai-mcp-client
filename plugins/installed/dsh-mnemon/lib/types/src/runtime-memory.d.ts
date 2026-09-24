import type { MnemonRunner } from './runner.ts';
import type { AuthorityCommitRecorder } from './memory-receipts.ts';
import type { MemoryMigrationLineage } from '../packages/contracts/src/index.ts';
import type { RuntimeMemoryAction, RuntimeMemoryCompactedEntry, RuntimeMemoryEntry, RuntimeMemoryMutation, RuntimeMemoryMutationResult, RuntimeMemorySnapshot, RuntimeMemoryTarget } from './shared/contracts.ts';
export type { RuntimeMemoryAction, RuntimeMemoryCompactedEntry, RuntimeMemoryEntry, RuntimeMemoryImportance, RuntimeMemoryMutation, RuntimeMemoryMutationResult, RuntimeMemorySnapshot, RuntimeMemoryTarget, RuntimeMemoryTargetView, RuntimeMemoryUsage, } from './shared/contracts.ts';
export declare const RUNTIME_MEMORY_VERSION = 1;
export declare const RUNTIME_ENTRY_DELIMITER = "\n\u00A7\n";
export declare const RUNTIME_MEMORY_LIMITS: {
    readonly memory: number;
    readonly user: number;
};
export interface RuntimeMemoryContextProjection {
    revision: string;
    text: string;
}
/** Host-only plan for capacity maintenance; this is not exposed as a Tool or RPC action. */
export interface RuntimeMemoryMaintenancePlan {
    revision: string;
    action: RuntimeMemoryAction;
    target: RuntimeMemoryTarget;
    entries: RuntimeMemoryEntry[];
    pending?: RuntimeMemoryCompactedEntry;
    excluded?: RuntimeMemoryEntry;
    used: number;
    projected: number;
    limit: number;
    requiresMaintenance: boolean;
}
export declare class RuntimeMemoryCapacityError extends Error {
    readonly target: RuntimeMemoryTarget;
    readonly used: number;
    readonly projected: number;
    readonly limit: number;
    constructor(target: RuntimeMemoryTarget, used: number, projected: number, limit: number);
}
export declare class RuntimeMemoryConflictError extends Error {
    constructor();
}
/**
 * Single authority for hot memory. JSON is the durable source of truth;
 * Markdown files are deterministic projections consumed by prompt assembly.
 */
export declare class RuntimeMemoryController {
    private readonly now;
    private readonly recordCommit?;
    readonly directory: string;
    readonly sourcePath: string;
    readonly memoryPath: string;
    readonly userPath: string;
    readonly lockPath: string;
    private queue;
    constructor(runner: Pick<MnemonRunner, 'effectiveDataDir'>, now?: () => Date, recordCommit?: AuthorityCommitRecorder | undefined);
    snapshot(): RuntimeMemorySnapshot;
    contextText(): string;
    /** Read the exact Runtime revision and its prompt projection under one lock. */
    contextProjection(): RuntimeMemoryContextProjection;
    mutate(request: RuntimeMemoryMutation): Promise<RuntimeMemoryMutationResult>;
    /** Resolve exactly which committed entries survive a blocked mutation and are safe to compact. */
    planMaintenance(request: RuntimeMemoryMutation): Promise<RuntimeMemoryMaintenancePlan>;
    /** Commit semantic compaction and the original mutation together, or leave every local file unchanged. */
    compactAndMutate(expectedRevision: string, request: RuntimeMemoryMutation, compacted: RuntimeMemoryCompactedEntry[], maxCompactedBytes?: number, lineage?: readonly MemoryMigrationLineage[]): Promise<RuntimeMemoryMutationResult>;
    /** Apply an LLM-produced compaction only to the exact snapshot it reviewed. */
    compactTarget(expectedRevision: string, target: RuntimeMemoryTarget, compacted: RuntimeMemoryCompactedEntry[], maxBytes?: number, lineage?: readonly MemoryMigrationLineage[]): Promise<RuntimeMemorySnapshot>;
    private initialize;
    private mutateLocked;
    private result;
    private targetView;
    private snapshotUnlocked;
    private readSource;
    private persist;
    private repairProjections;
    private withLock;
}

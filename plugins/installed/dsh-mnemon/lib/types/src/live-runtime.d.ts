import type { ResolvedConfig } from './config.ts';
import type { HostAgent, HostAgentsService, HostWorkspace, HostWorkspaceRegistry } from './contracts.ts';
import { DocumentManager } from './documents.ts';
import { MnemonPackManager } from './pack.ts';
import { type MnemonRunner } from './runner.ts';
import { RuntimeMemoryController } from './runtime-memory.ts';
import { MnemonService } from './service.ts';
import { StorageScopeInspector } from './storage-scope.ts';
import { MemoryCatalog } from './memory-system/catalog.ts';
import { MemoryKernel } from './memory-system/kernel.ts';
import { MemoryTopologyManager } from './memory-system/topology.ts';
import type { MemoryBoot } from '../packages/extension-sdk/src/index.ts';
import type { MemoryTurnViewManager } from '../packages/kernel/src/index.ts';
export interface MnemonRuntimeGraph {
    config: ResolvedConfig;
    runner: MnemonRunner;
    service: MnemonService;
    runtimeMemory: RuntimeMemoryController;
    documents: DocumentManager;
    storage: StorageScopeInspector;
    packs: MnemonPackManager;
    memoryCatalog: MemoryCatalog;
    memoryTopology: MemoryTopologyManager;
    memoryKernel: MemoryKernel;
    memoryViews: MemoryTurnViewManager;
    /** Detach this generation from future Host-global extension changes. */
    dispose(): void;
}
export interface MnemonAgentRuntimeSource {
    readonly config: ResolvedConfig;
    forAgent(agent: HostAgent): MnemonRuntimeGraph;
    /** Pin every tool in one Agent turn to the same immutable runtime generation. */
    bindAgentRuntime(agentId: string, graph: MnemonRuntimeGraph): () => void;
}
/**
 * Build a complete generation before it can become visible. Constructors also
 * validate and initialize the selected storage root, so a failed candidate is
 * rejected by DSH settings validation without disturbing the active graph.
 */
export declare function createRuntimeGraph(config: ResolvedConfig, workspaceRoot?: string, extensions?: MemoryBoot): MnemonRuntimeGraph;
/**
 * Stable faces handed to DSH registrations. `swap` is synchronous and contains
 * no user code, so all faces move to the same prevalidated generation in one
 * JavaScript turn. A method obtained before the swap stays bound to its old
 * generation until that invocation settles.
 */
export declare class LiveMnemonRuntime implements MnemonAgentRuntimeSource {
    private readonly workspaceRegistry?;
    private readonly agents?;
    private readonly extensions?;
    private current;
    private readonly workspaceGraphs;
    private readonly agentGraphs;
    private closed;
    readonly config: ResolvedConfig;
    readonly runner: MnemonRunner;
    readonly service: MnemonService;
    readonly runtimeMemory: RuntimeMemoryController;
    readonly documents: DocumentManager;
    readonly storage: StorageScopeInspector;
    readonly packs: MnemonPackManager;
    readonly memoryCatalog: MemoryCatalog;
    readonly memoryTopology: MemoryTopologyManager;
    readonly memoryKernel: MemoryKernel;
    readonly memoryViews: MemoryTurnViewManager;
    constructor(initial: MnemonRuntimeGraph, workspaceRegistry?: HostWorkspaceRegistry | undefined, agents?: HostAgentsService | undefined, extensions?: MemoryBoot | undefined);
    swap(next: MnemonRuntimeGraph): void;
    snapshot(): MnemonRuntimeGraph;
    bindAgentRuntime(agentId: string, graph: MnemonRuntimeGraph): () => void;
    dispose(): void;
    /** Resolve the runtime that must serve one Agent execution. */
    forAgent(agent: HostAgent): MnemonRuntimeGraph;
    /** Resolve an authorized DSH workspace selected by the Web workbench. */
    forWorkspaceId(workspaceId: string): MnemonRuntimeGraph;
    /** Resolve a Web request, preferring its explicit inspection workspace. */
    route(request: {
        workspaceId?: string;
        sessionId?: string;
    }): {
        graph: MnemonRuntimeGraph;
        selectedWorkspace?: HostWorkspace;
        effectiveWorkspace?: HostWorkspace;
        selectedRoot: string;
        effectiveRoot: string;
        aligned: boolean;
    };
    private forWorkspacePath;
    private assertOpen;
    private agent;
    private requireWorkspace;
    private workspaceForPath;
}

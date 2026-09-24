import type { HostAgent, HostContextShape } from './contracts.ts';
import type { ResolvedConfig } from './config.ts';
import type { RuntimeMemoryController } from './runtime-memory.ts';
import type { MemoryWake } from '../packages/contracts/src/index.ts';
export declare const GUIDANCE_SECTION_NAME = "mnemon:routing";
export declare const RUNTIME_MEMORY_CONTEXT_NAME = "mnemon:runtime-memory";
export declare const ROUTING_GUIDANCE = "Use memory only when needed. Search Mnemon Documents for substantial project records. Call mnemon_recall for durable history or exact prior details; never infer a missing historical rule. Put only new user facts or explicit save/correction requests in mnemon_runtime_memory; never cache retrieved evidence. A write exists only after its receipt.";
/** Replace the already-materialized Agent context with the Wake pinned during assembly. */
export declare function applyAgentMemoryViewWake<T extends {
    contexts: Array<{
        name: string;
        text: string;
    }>;
}>(assembly: T, wake: MemoryWake | undefined): T;
/** Register the non-recursive escape used by both legacy Runtime and View Wake contexts. */
export declare function registerMemoryPromptInterpolation(ctx: HostContextShape): void;
export declare function registerGuidance(ctx: HostContextShape, config?: Pick<ResolvedConfig, 'routingGuidance'>): void;
/** Project the latest committed USER.md/MEMORY.md as DSH's durable runtime-context snapshot. */
export declare function registerRuntimeMemoryContext(ctx: HostContextShape, runtimeMemory: RuntimeMemoryController, enabled?: () => boolean): void;
/** Shadow the global fallback with the current Agent workspace's hot memory. */
export declare function registerAgentRuntimeMemoryContext(agent: HostAgent, runtimeMemory: () => RuntimeMemoryController, enabled?: () => boolean): () => void;
/** Project only the immutable Wake pinned by the root Agent lifecycle. */
export declare function registerAgentMemoryViewContext(agent: HostAgent, wake: () => MemoryWake | undefined): () => void;

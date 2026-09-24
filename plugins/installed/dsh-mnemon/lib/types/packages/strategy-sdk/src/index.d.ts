import type { MemoryPlanProposal, MemoryPlanRequest, MemorySystemDescriptor } from '../../contracts/src/index.ts';
import type { MemoryStrategyRegistration } from '../../kernel/src/index.ts';
export declare const MEMORY_STRATEGY_PLUGIN_API_VERSION: "dsh-mnemon/v1alpha1";
export interface MemoryStrategyPluginManifest {
    apiVersion: typeof MEMORY_STRATEGY_PLUGIN_API_VERSION;
    kind: 'MemoryStrategyPlugin';
    metadata: {
        id: string;
        version: string;
        label: string;
        description: string;
    };
    permissions: {
        layerIds: string[];
        adapterIds: string[];
        capabilities: MemoryPlanRequest['capability'][];
        maxSteps: number;
    };
}
export interface MemoryStrategyPlugin {
    manifest: MemoryStrategyPluginManifest;
    strategy: MemoryStrategyRegistration;
}
/** Define an immutable, declarative strategy package; the Kernel remains authoritative. */
export declare function defineMemoryStrategyPlugin(plugin: MemoryStrategyPlugin): Readonly<MemoryStrategyPlugin>;
export interface MemoryStrategyReplayCase {
    request: MemoryPlanRequest;
    descriptor: MemorySystemDescriptor;
    assert(proposal: MemoryPlanProposal): void | Promise<void>;
}
/** Deterministic replay primitive for generated and hand-written strategies. */
export declare function replayMemoryStrategy(strategy: MemoryStrategyRegistration, cases: readonly MemoryStrategyReplayCase[]): Promise<void>;
export declare function defineMemoryStrategy<T extends MemoryStrategyRegistration>(strategy: T): T;
export type { MemoryPlanProposal, MemoryPlanRequest, MemoryStrategyDescriptor, MemoryStrategyHook, MemorySystemDescriptor, } from '../../contracts/src/index.ts';
export type { MemoryStrategyContext, MemoryStrategyRegistration } from '../../kernel/src/index.ts';

import type { MemoryAdapterDescriptor, MemoryCatalogSnapshot, MemoryJsonValue, MemoryLayerDescriptor, MemoryPlanRequest, MemoryPlanProposal, MemoryPlanStep, MemoryStrategyDescriptor, MemoryTopologySnapshot } from '../../contracts/src/index.ts';
export interface MemoryLayerExecutionContext {
    planId: string;
    topology: MemoryTopologySnapshot;
    request: MemoryPlanRequest;
    signal?: AbortSignal;
}
export interface MemoryLayerRegistration {
    descriptor: MemoryLayerDescriptor;
    execute?(step: MemoryPlanStep, context: MemoryLayerExecutionContext): Promise<MemoryJsonValue>;
}
export interface MemoryAdapterRegistration {
    descriptor: MemoryAdapterDescriptor;
}
export interface MemoryStrategyContext {
    catalog: MemoryCatalogSnapshot;
    topology: MemoryTopologySnapshot;
}
export interface MemoryStrategyRegistration {
    descriptor: MemoryStrategyDescriptor;
    propose(request: MemoryPlanRequest, context: MemoryStrategyContext): MemoryPlanProposal | Promise<MemoryPlanProposal>;
}
export type MemoryCatalogListener = (snapshot: MemoryCatalogSnapshot) => void;
/** Host-global contribution directory. Registrations are owned by their caller's lifecycle. */
export declare class MemoryCatalog {
    private readonly layers;
    private readonly adapters;
    private readonly strategies;
    private readonly listeners;
    private currentGeneration;
    get generation(): number;
    registerLayer(registration: MemoryLayerRegistration): () => void;
    registerAdapter(registration: MemoryAdapterRegistration): () => void;
    registerStrategy(registration: MemoryStrategyRegistration): () => void;
    layer(id: string): MemoryLayerRegistration | undefined;
    adapter(id: string): MemoryAdapterRegistration | undefined;
    strategy(id: string): MemoryStrategyRegistration | undefined;
    snapshot(): MemoryCatalogSnapshot;
    subscribe(listener: MemoryCatalogListener): () => void;
    private register;
    private changed;
}

import type { MemoryCatalog } from './catalog.ts';
import type { MemoryLayerParticipation, MemoryTopologyDefinition, MemoryTopologySnapshot } from '../../contracts/src/index.ts';
export type MemoryTopologyListener = (next: MemoryTopologySnapshot, previous: MemoryTopologySnapshot | undefined) => void;
/** Atomic, versioned topology state. Per-operation callers pin one returned snapshot. */
export declare class MemoryTopologyManager {
    private readonly catalog;
    private readonly now;
    private current?;
    private currentGeneration;
    private readonly listeners;
    private readonly unsubscribeCatalog;
    constructor(catalog: MemoryCatalog, initial: MemoryTopologyDefinition, now?: () => Date);
    snapshot(): MemoryTopologySnapshot;
    replace(definition: MemoryTopologyDefinition): MemoryTopologySnapshot;
    configureLayer(id: string, patch: {
        enabled?: boolean;
        participation?: Partial<MemoryLayerParticipation>;
        adapterIds?: string[];
    }): MemoryTopologySnapshot;
    subscribe(listener: MemoryTopologyListener): () => void;
    /** Stop following Catalog changes while preserving this generation for pinned operations. */
    dispose(): void;
    private reconcileCatalog;
    private validate;
}

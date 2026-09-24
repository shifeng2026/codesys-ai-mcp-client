import type { MemoryLayerDescriptor } from '../../contracts/src/index.ts';
import type { MemoryCatalog, MemoryLayerRegistration } from '../../kernel/src/index.ts';
export declare const MEMORY_SPACES_LAYER: Readonly<MemoryLayerDescriptor>;
export declare function registerMemorySpacesLayer(catalog: MemoryCatalog, registration?: Omit<MemoryLayerRegistration, 'descriptor'>): () => void;

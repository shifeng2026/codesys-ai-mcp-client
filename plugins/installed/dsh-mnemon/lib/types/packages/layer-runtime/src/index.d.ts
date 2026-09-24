import type { MemoryLayerDescriptor } from '../../contracts/src/index.ts';
import type { MemoryCatalog, MemoryLayerRegistration } from '../../kernel/src/index.ts';
export declare const RUNTIME_MEMORY_LAYER: Readonly<MemoryLayerDescriptor>;
export declare function registerRuntimeMemoryLayer(catalog: MemoryCatalog, registration?: Omit<MemoryLayerRegistration, 'descriptor'>): () => void;

import type { MemoryLayerDescriptor } from '../../contracts/src/index.ts';
import type { MemoryCatalog, MemoryLayerRegistration } from '../../kernel/src/index.ts';
export declare const DOCUMENTS_MEMORY_LAYER: Readonly<MemoryLayerDescriptor>;
export declare function registerDocumentsMemoryLayer(catalog: MemoryCatalog, registration?: Omit<MemoryLayerRegistration, 'descriptor'>): () => void;

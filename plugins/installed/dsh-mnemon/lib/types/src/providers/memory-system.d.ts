import type { MemoryCatalog } from '../memory-system/catalog.ts';
import type { MemoryAdapterDescriptor, MemoryCapability } from '../memory-system/contracts.ts';
import type { MemoryProviderDescriptor } from '../shared/contracts.ts';
export declare function providerMemoryCapabilities(provider: MemoryProviderDescriptor): MemoryCapability[];
export declare function providerMemoryAdapterDescriptor(provider: MemoryProviderDescriptor): MemoryAdapterDescriptor;
export declare function registerBuiltinMemoryAdapters(catalog: MemoryCatalog): () => void;

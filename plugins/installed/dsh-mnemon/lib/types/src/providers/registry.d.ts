import type { ResolvedConfig } from '../config.ts';
import type { MemoryBodyRegistry } from '../memory-bodies.ts';
import type { MemoryProviderAdapter } from './provider.ts';
import { MemoryAdapterFactoryRegistry, type MemoryAdapterFactory } from '../../packages/provider-sdk/src/index.ts';
export interface MemoryProviderAdapterFactoryContext {
    memoryBodies: MemoryBodyRegistry;
    config: Pick<ResolvedConfig, 'timeoutMs'>;
    nativeAdapter: MemoryProviderAdapter;
}
export interface MemoryProviderAdapterFactory extends MemoryAdapterFactory<MemoryProviderAdapter['id'], MemoryProviderAdapterFactoryContext, MemoryProviderAdapter> {
}
/**
 * Runtime adapter factory seam. The control plane owns registration and
 * provider implementations own construction; MnemonService depends only on
 * the resulting adapter contract.
 */
export declare class MemoryProviderAdapterRegistry extends MemoryAdapterFactoryRegistry<MemoryProviderAdapter['id'], MemoryProviderAdapterFactoryContext, MemoryProviderAdapter> {
}
export declare const BUILTIN_MEMORY_PROVIDER_ADAPTER_FACTORIES: readonly MemoryProviderAdapterFactory[];
export declare function createBuiltinMemoryProviderAdapterRegistry(): MemoryProviderAdapterRegistry;
/** Global extension registry sampled when a runtime generation is constructed. */
export declare const memoryProviderAdapterFactories: MemoryProviderAdapterRegistry;
export declare function registerMemoryProviderAdapterFactory(factory: MemoryProviderAdapterFactory): () => void;

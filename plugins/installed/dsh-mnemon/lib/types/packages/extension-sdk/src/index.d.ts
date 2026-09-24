import type { MemoryAdapterRegistration, MemoryCatalog, MemoryLayerRegistration, MemoryStrategyRegistration } from '../../kernel/src/catalog.ts';
import type { MemoryGuardRegistration, MemoryKernel } from '../../kernel/src/kernel.ts';
import type { MemorySource, MemoryTurnViewManager } from '../../kernel/src/view.ts';
export interface MemoryExtensionDescriptor {
    id: string;
    version: string;
    label: string;
    description: string;
}
export interface MemoryExtension {
    descriptor: MemoryExtensionDescriptor;
    layers?: readonly MemoryLayerRegistration[];
    adapters?: readonly MemoryAdapterRegistration[];
    strategies?: readonly MemoryStrategyRegistration[];
    /** Trusted, query-independent Sources for extension Layers. */
    sources?: readonly MemorySource[];
    /** Guards can only deny; strategies and data-plane executors cannot bypass them. */
    guards?: readonly MemoryGuardRegistration[];
}
export interface MemoryBootAttachment {
    bindKernel(kernel: MemoryKernel): void;
    bindTurnViews(manager: MemoryTurnViewManager): void;
    dispose(): void;
    release(): void;
}
/** Compatibility name for the v0.3 pre-release API. */
export type MemoryExtensionAttachment = MemoryBootAttachment;
/**
 * Minimal Boot assembler for one Host. It applies the same captured extension
 * set to every runtime graph while each graph owns its Catalog, Kernel, and
 * TurnView state. Cordis remains responsible for lifecycle and isolation.
 */
export declare class MemoryBoot {
    private readonly extensions;
    private readonly targets;
    register(extension: MemoryExtension): () => void;
    attach(catalog: MemoryCatalog): MemoryBootAttachment;
    descriptors(): MemoryExtensionDescriptor[];
    private apply;
    private applyChecked;
    /** Remove one global extension from every live graph, or restore it everywhere. */
    private unregister;
}
/** Compatibility name for the v0.3 pre-release API. */
export { MemoryBoot as MemoryExtensionHost };
export declare function defineMemoryExtension<T extends MemoryExtension>(extension: T): T;
/** Process-global Boot, allowing extensions to contribute before the DSH Host mounts. */
export declare const memoryBoot: MemoryBoot;
/** Compatibility name for the v0.3 pre-release API. */
export declare const memoryExtensions: MemoryBoot;
export declare function registerMemoryExtension(extension: MemoryExtension): () => void;
export type { MemoryAdapterRegistration, MemoryLayerRegistration, MemoryStrategyRegistration } from '../../kernel/src/catalog.ts';
export type { MemoryGuardRegistration } from '../../kernel/src/kernel.ts';
export type { MemorySource } from '../../kernel/src/view.ts';

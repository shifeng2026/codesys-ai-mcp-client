import type { MemoryAdapterDescriptor } from '../../contracts/src/index.ts';
export interface MemoryAdapterFactory<Id extends string, Context, Adapter extends {
    readonly id: Id;
}> {
    readonly id: Id;
    create(context: Context): Adapter;
}
/** Lifecycle-owned factory directory used by Provider plugins and the Host. */
export declare class MemoryAdapterFactoryRegistry<Id extends string, Context, Adapter extends {
    readonly id: Id;
}> {
    private readonly factories;
    constructor(factories?: readonly MemoryAdapterFactory<Id, Context, Adapter>[]);
    register(factory: MemoryAdapterFactory<Id, Context, Adapter>): () => void;
    create(context: Context): Map<Id, Adapter>;
    ids(): Id[];
}
export declare function defineMemoryAdapterDescriptor<T extends MemoryAdapterDescriptor>(descriptor: T): T;
export type { MemoryAdapterDescriptor, MemoryAdapterLocality, MemoryAdapterScope, MemoryCapability, MemoryJsonValue, } from '../../contracts/src/index.ts';

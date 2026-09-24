import type { MemoryCatalog, MemoryLayerRegistration, MemoryStrategyRegistration } from '../../kernel/src/index.ts';
import type { MemoryLayerParticipation, MemoryTopologyDefinition } from '../../contracts/src/index.ts';
export declare const BUILTIN_MEMORY_LAYERS: readonly [Readonly<import("../../contracts/src/index.ts").MemoryLayerDescriptor>, Readonly<import("../../contracts/src/index.ts").MemoryLayerDescriptor>, Readonly<import("../../contracts/src/index.ts").MemoryLayerDescriptor>];
export declare const DEFAULT_LAYER_PARTICIPATION: Readonly<MemoryLayerParticipation>;
export declare const DEFAULT_THREE_TIER_TOPOLOGY: Readonly<MemoryTopologyDefinition>;
export declare const DEFAULT_THREE_TIER_STRATEGY: MemoryStrategyRegistration;
export declare function registerDefaultMemorySystem(catalog: MemoryCatalog, layers?: Partial<Record<string, Omit<MemoryLayerRegistration, 'descriptor'>>>): () => void;

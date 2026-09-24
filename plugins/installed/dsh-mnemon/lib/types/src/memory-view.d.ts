import { MemoryTurnViewManager } from '../packages/kernel/src/index.ts';
import type { DocumentManager } from './documents.ts';
import type { MemoryKernel } from './memory-system/kernel.ts';
import type { RuntimeMemoryController } from './runtime-memory.ts';
import type { MnemonService } from './service.ts';
export interface DefaultMemorySources {
    runtimeMemory: RuntimeMemoryController;
    documents: DocumentManager;
    service: MnemonService;
}
/** Compatibility name for the v0.3 pre-release API. */
export type DefaultMemoryViewSources = DefaultMemorySources;
export declare function createDefaultMemoryTurnViewManager(kernel: MemoryKernel, sources: DefaultMemorySources): MemoryTurnViewManager;
/** Compatibility name for the v0.3 pre-release API. */
export declare const createDefaultMemoryViewManager: typeof createDefaultMemoryTurnViewManager;

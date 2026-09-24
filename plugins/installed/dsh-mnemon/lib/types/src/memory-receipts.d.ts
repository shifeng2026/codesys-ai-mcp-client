import type { MemoryCapability, MemoryJsonValue, MemoryReceipt } from '../packages/contracts/src/index.ts';
import type { MemoryKernel, MemoryReceiptSink } from '../packages/kernel/src/index.ts';
import type { MemoryTurnViewManager } from '../packages/kernel/src/index.ts';
export interface CommittedAuthorityOperation {
    layerId: string;
    capability: MemoryCapability;
    operation: string;
    adapterId?: string;
    checkpoint?: MemoryJsonValue;
}
export type AuthorityCommitRecorder = (operation: CommittedAuthorityOperation) => MemoryReceipt;
/** Converts already-committed compatibility-controller writes into the one receipt contract. */
export declare class MemoryReceiptBridge implements MemoryReceiptSink {
    private readonly kernel;
    private readonly views;
    private readonly now;
    private readonly id;
    constructor(kernel: Pick<MemoryKernel, 'descriptor' | 'guardGeneration'>, views: Pick<MemoryTurnViewManager, 'apply'>, now?: () => Date, id?: () => string);
    append(receipt: MemoryReceipt): void;
    record(operation: CommittedAuthorityOperation): MemoryReceipt;
}

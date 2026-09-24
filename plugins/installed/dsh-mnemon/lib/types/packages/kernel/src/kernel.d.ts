import type { MemoryCatalog } from './catalog.ts';
import type { MemoryCapability, MemoryGuardDecision, MemoryOperationTrigger, MemoryPlan, MemoryPlanRequest, MemoryReceipt, MemorySystemDescriptor } from '../../contracts/src/index.ts';
import { type MemoryParticipationDecision } from './access.ts';
import type { MemoryTopologyManager } from './topology.ts';
export interface MemoryGuardContext {
    descriptor: MemorySystemDescriptor;
}
export interface MemoryGuardRegistration {
    id: string;
    decide(request: MemoryPlanRequest, context: MemoryGuardContext): MemoryGuardDecision | Promise<MemoryGuardDecision>;
}
export interface MemoryReceiptSink {
    append(receipt: MemoryReceipt): void | Promise<void>;
}
export interface MemoryKernelOptions {
    now?: () => Date;
    id?: () => string;
    receiptSink?: MemoryReceiptSink;
}
/** Plans and executes bounded operations without granting strategies direct data-plane access. */
export declare class MemoryKernel {
    readonly catalog: MemoryCatalog;
    readonly topology: MemoryTopologyManager;
    private readonly guards;
    private currentGuardGeneration;
    private readonly now;
    private readonly id;
    private readonly receiptSinks;
    private readonly issuedPlans;
    constructor(catalog: MemoryCatalog, topology: MemoryTopologyManager, options?: MemoryKernelOptions);
    get guardGeneration(): number;
    registerReceiptSink(sink: MemoryReceiptSink): () => void;
    descriptor(): MemorySystemDescriptor;
    participation(layerId: string, capability: MemoryCapability, trigger: MemoryOperationTrigger): MemoryParticipationDecision;
    allows(layerId: string, capability: MemoryCapability, trigger: MemoryOperationTrigger): boolean;
    assertParticipation(layerId: string, capability: MemoryCapability, trigger: MemoryOperationTrigger): MemoryParticipationDecision;
    registerGuard(guard: MemoryGuardRegistration): () => void;
    plan(request: MemoryPlanRequest): Promise<MemoryPlan>;
    execute(plan: MemoryPlan, request: MemoryPlanRequest, signal?: AbortSignal): Promise<MemoryReceipt>;
    run(request: MemoryPlanRequest, signal?: AbortSignal): Promise<{
        plan: MemoryPlan;
        receipt: MemoryReceipt;
    }>;
    private validateStep;
    private rememberPlan;
}

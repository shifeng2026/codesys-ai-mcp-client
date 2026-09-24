import type { MemoryJsonValue, MemoryOperationScope, MemoryReceipt, MemorySourceMode, MemoryTurnContext, MemoryTurnView, MemoryWake } from '../../contracts/src/index.ts';
import type { MemoryKernel } from './kernel.ts';
export interface MemorySourceSnapshot {
    /** Changes whenever the source's recall authority or Wake projection changes. */
    revision: string;
    /** Exact eager content or one compact routed cover. */
    wake: string;
    /** Host-only JSON authority. It is digest-bound and never rendered into Wake. */
    state?: MemoryJsonValue;
}
export interface MemorySourceContext {
    catalogGeneration: number;
    topologyGeneration: number;
    guardGeneration: number;
    scope?: MemoryOperationScope;
}
/** Trusted source adapter. It snapshots authority without receiving a Strategy. */
export interface MemorySource {
    layerId: string;
    mode: MemorySourceMode;
    snapshot(context: MemorySourceContext): MemorySourceSnapshot | Promise<MemorySourceSnapshot>;
}
export interface MemoryTurnViewManagerOptions {
    now?: () => Date;
    maxViews?: number;
    maxWakeCharacters?: number;
    maxCoverCharacters?: number;
}
/** Compatibility name for the v0.3 pre-release API. */
export type MemoryViewManagerOptions = MemoryTurnViewManagerOptions;
/**
 * Owns immutable Source snapshots and turn pins. Source state is Host-only;
 * Wake is a separately budgeted projection and never defines recall authority.
 */
export declare class MemoryTurnViewManager {
    readonly kernel: Pick<MemoryKernel, 'descriptor' | 'guardGeneration'>;
    private readonly sources;
    private sourceGeneration;
    private readonly views;
    private readonly turns;
    private readonly pendingReceipts;
    private current;
    private readonly currentByScope;
    private readonly publishing;
    private failure;
    private readonly now;
    private readonly maxViews;
    private readonly maxWakeCharacters;
    private readonly maxCoverCharacters;
    constructor(kernel: Pick<MemoryKernel, 'descriptor' | 'guardGeneration'>, sources?: Iterable<MemorySource>, options?: MemoryTurnViewManagerOptions);
    registerSource(source: MemorySource): () => void;
    /** Validate every automatic project-capable Layer before a runtime graph becomes live. */
    assertSourcesReady(): void;
    latest(): MemoryTurnView | undefined;
    get(viewId: string): MemoryTurnView | undefined;
    /** Read digest-bound recall authority. This state is never rendered into Wake. */
    sourceState(viewId: string, layerId: string): MemoryJsonValue | undefined;
    lastFailure(): string | undefined;
    pendingReceiptCount(): number;
    apply(receipt: MemoryReceipt): boolean;
    beginTurn(turnId: string, scope: MemoryOperationScope): Promise<MemoryTurnContext>;
    turn(turnId: string): MemoryTurnContext | undefined;
    activeTurn(agentId: string): MemoryTurnContext | undefined;
    endTurn(turnId: string): boolean;
    wake(viewId: string): MemoryWake;
    /** Compile and publish a candidate. On failure, preserve the last valid scoped View. */
    reconcile(scope?: MemoryOperationScope): Promise<MemoryTurnView>;
    /** Strict publication API used by tests, diagnostics, and initial startup. */
    publish(scope?: MemoryOperationScope): Promise<MemoryTurnView>;
    private buildCandidate;
    private normalizeSource;
    private renderWake;
    private requireStoredView;
    private rememberScopeCurrent;
    private collect;
}
/** Compatibility name for the v0.3 pre-release API. */
export { MemoryTurnViewManager as MemoryViewManager };

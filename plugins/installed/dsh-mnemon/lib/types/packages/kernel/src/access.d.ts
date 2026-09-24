import type { MemoryCapability, MemoryOperationTrigger, MemoryParticipationChannel, MemoryParticipationMode, MemoryTopologyLayer } from '../../contracts/src/index.ts';
export declare function participationChannel(capability: MemoryCapability): MemoryParticipationChannel;
export interface MemoryParticipationDecision {
    allowed: boolean;
    layerId: string;
    capability: MemoryCapability;
    trigger: MemoryOperationTrigger;
    channel: MemoryParticipationChannel;
    mode: MemoryParticipationMode;
    reason?: string;
}
/** Evaluate one topology boundary without invoking strategy or data-plane code. */
export declare function decideMemoryLayerParticipation(layer: MemoryTopologyLayer, capability: MemoryCapability, trigger: MemoryOperationTrigger): MemoryParticipationDecision;
export declare function assertMemoryLayerParticipation(layer: MemoryTopologyLayer, capability: MemoryCapability, trigger: MemoryOperationTrigger): MemoryParticipationDecision;

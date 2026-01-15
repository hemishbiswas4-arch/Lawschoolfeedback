// =======================================================
// FILE: app/lib/queueState.ts
// PURPOSE: Shared queue state management for generation and synthesis
// =======================================================

/* ================= GENERATION QUEUE ================= */

export type QueuedGenerationRequest = {
  user_id: string
  project_id: string
  query_text: string
  mode: "generate" | "retrieve"
  word_limit?: number
  approach?: any
  resolve: (value: any) => void
  reject: (error: any) => void
  runId: string
  queuedAt: number
}

export const generationQueue: QueuedGenerationRequest[] = []
let _generationQueueProcessing = false
export let generationThrottlingDetected = false
export let generationThrottlingDetectedAt: number | null = null

// Export getter for processing flag
export const generationQueueProcessing = () => _generationQueueProcessing

export function setGenerationQueueProcessing(value: boolean) {
  _generationQueueProcessing = value
}

export function setGenerationThrottlingDetected(value: boolean, timestamp?: number) {
  generationThrottlingDetected = value
  generationThrottlingDetectedAt = timestamp || null
}

export function getGenerationQueueStatus(userId: string) {
  const userQueuePosition = generationQueue.findIndex(req => req.user_id === userId)
  const isInQueue = userQueuePosition !== -1
  const queuePosition = isInQueue ? userQueuePosition + 1 : null
  const estimatedWait = queuePosition ? (queuePosition - 1) * 60 : null // Rough estimate: 60 seconds per position
  
  return {
    in_queue: isInQueue,
    queue_position: queuePosition,
    estimated_wait_seconds: estimatedWait,
    queue_mode_active: generationThrottlingDetected,
    total_queue_length: generationQueue.length,
  }
}

/* ================= SYNTHESIS QUEUE ================= */

export type QueuedSynthesisRequest = {
  user_id: string
  project_id: string
  query_text: string
  retrieved_chunks: any[]
  project_type?: string
  resolve: (value: any) => void
  reject: (error: any) => void
  runId: string
  queuedAt: number
}

export const synthesisQueue: QueuedSynthesisRequest[] = []
let _synthesisQueueProcessing = false
export let synthesisThrottlingDetected = false
export let synthesisThrottlingDetectedAt: number | null = null

// Export getter for processing flag
export const synthesisQueueProcessing = () => _synthesisQueueProcessing

export function setSynthesisQueueProcessing(value: boolean) {
  _synthesisQueueProcessing = value
}

export function setSynthesisThrottlingDetected(value: boolean, timestamp?: number) {
  synthesisThrottlingDetected = value
  synthesisThrottlingDetectedAt = timestamp || null
}

export function getSynthesisQueueStatus(userId: string) {
  const userQueuePosition = synthesisQueue.findIndex(req => req.user_id === userId)
  const isInQueue = userQueuePosition !== -1
  const queuePosition = isInQueue ? userQueuePosition + 1 : null
  const estimatedWait = queuePosition ? (queuePosition - 1) * 30 : null // Rough estimate: 30 seconds per position
  
  return {
    in_queue: isInQueue,
    queue_position: queuePosition,
    estimated_wait_seconds: estimatedWait,
    queue_mode_active: synthesisThrottlingDetected,
    total_queue_length: synthesisQueue.length,
  }
}

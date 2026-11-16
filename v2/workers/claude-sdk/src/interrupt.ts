/**
 * A turn the person interrupted ends with Claude's "error during execution"
 * diagnostic ("[ede_diagnostic] result_type=user … stop_reason=tool_use").
 * That failure only reports the interrupt; it must not fault the conversation.
 * Account limits and sign-in problems still count.
 */
export function droppedOnInterrupt(event: { type?: string; status?: string }): boolean {
  return event.type === 'failure' && (event.status === 'provider_error' || event.status === 'unknown' || event.status === 'error_during_execution');
}

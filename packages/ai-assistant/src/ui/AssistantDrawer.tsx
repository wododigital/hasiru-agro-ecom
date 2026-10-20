import { CART_CHANGED_EVENT, CART_LINES_PATH } from '@ecomkit/catalog/ui';
import { STREAM_PATH } from '../domain/stream';
import { assistantRuntime } from '../server/runtime';
import { AssistantTriggerIsland } from './AssistantTriggerIsland';

/**
 * The header "Ask" button and its drawer. Static markup (no request data), so it sits in a prerendered shell;
 * the drawer's code loads on intent and the answers stream from /api/assistant/stream.
 */
export function AssistantDrawer({ className }: { className?: string }) {
  const rt = assistantRuntime();
  const { drawer, modes, suggestions, errors } = rt.messages;
  return (
    <AssistantTriggerIsland
      className={className}
      copy={{ drawer, modes, suggestions, errors }}
      streamPath={STREAM_PATH}
      cart={rt.registry?.has('cart') ? { path: CART_LINES_PATH, changedEvent: CART_CHANGED_EVENT } : null}
    />
  );
}

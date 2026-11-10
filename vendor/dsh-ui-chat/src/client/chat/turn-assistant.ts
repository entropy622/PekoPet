import {visibleText} from '../../../../../plugin/frontend/text.mjs'
import type { AssistantBlock } from '../contract/snapshot.ts'

/**
 * Collect visible prose from one Assistant lifecycle.
 * @param blocks - Assistant content blocks.
 * @returns concatenated text blocks.
 */
export function assistantText(blocks: readonly AssistantBlock[], interrupted = false): string {
  return blocks.flatMap(block => block.kind === 'text' ? [visibleText(block.text, interrupted)] : []).join('')
}

// Default copy for the assistant. Plain strings only (the drawer is a client island and receives them as props);
// `{name}` style placeholders are filled by `fill()` from the domain. Hosts override any section through
// `configureAssistant({ messages })`. No em dashes anywhere.

export const assistantMessages = {
  drawer: {
    trigger: 'Ask',
    triggerAria: 'Open the shopping assistant',
    title: 'Ask our expert',
    eyebrow: 'Shopping assistant',
    intro: 'Answers come from our catalogue: prices, bulk rates, stock and growing facts.',
    greeting: 'Hello! Ask me about anything we sell: price, bulk rate, stock, or what suits your needs.',
    placeholder: 'e.g. Which items are in stock?',
    send: 'Ask',
    pending: 'Checking the catalogue...',
    close: 'Close',
    modeLabel: 'What do you need help with?',
    newChat: 'New chat',
    you: 'You',
    assistant: 'Assistant',
    addToCart: 'Add {name} to cart',
    added: 'Added',
    openProduct: 'View {name}',
    cardsHeading: 'Products in this answer',
    footnote: 'Prices and stock come live from the catalogue. Check the product page before you order.',
    followUps: 'You could also ask',
    loading: 'Loading the assistant',
  },
  modes: { shop: 'Shop', plan: 'Plan', farm: 'Farm' },
  suggestions: {
    shop: [
      'Which items are in stock?',
      'What is good for a 2 acre plot?',
      'Show me options under Rs 400',
      'What grows in partial shade?',
      'How does bulk pricing work?',
      'What can I add to what I already grow?',
    ],
    plan: ['What suits my district?', 'What bears fruit within 2 years?', 'How many do I need for 1 acre?', 'What grows well together?', 'Which ones fix nitrogen?', 'What grows in shade?'],
    farm: ['How does delivery work?', 'Can I return an order?', 'How does bulk pricing work?', 'Which items are in stock?', 'What is good for a 5 acre plot?', 'What suits a hot, dry place?'],
  },
  errors: {
    rate_limited: 'You have asked a lot of questions in a short time. Please try again in a while.',
    disabled: 'The assistant is not available right now. Browse the catalogue or contact us.',
    invalid: 'Please ask a shorter question (up to 400 characters).',
    network: 'Could not reach the assistant. Check your connection and try again.',
    failed: 'Something went wrong on our side. Please try again.',
    forbidden: 'This request was blocked. Reload the page and try again.',
    cut_short: 'Answer cut short. Ask a narrower question.',
  },
  answers: {
    intro: 'Here is what I found in our catalogue:',
    introCompanions: 'These grow well alongside {name}:',
    introFit: 'For {district}, here is what I found:',
    noMatch: 'I could not find a matching item in our catalogue. Try a product name, a category or a price, or contact our team for advice.',
    offTopic: 'I can only help with questions about our products and how to grow them.',
    greeting: 'Hello! Tell me what you are looking for, or pick a suggestion below.',
    bulk: 'Bulk pricing: the more you order of one item, the lower the price per unit. Each product shows its bulk price and the quantity it starts from.',
    delivery: 'Delivery depends on your location and order size. Enter your pincode on a product page or in the cart to see options and dates.',
    returns: 'Our returns and replacement terms are on the policies page. Contact us if anything arrives damaged.',
    acreage: 'For a larger area, the price per unit drops with bulk tiers.',
    companionsUnavailable: 'I could not look up companions right now, so here are related items instead.',
    closing: 'Tap an item to add it to your cart.',
  },
  facts: {
    each: '{price} each',
    bulk: '{price} each from {qty}',
    inStock: 'in stock',
    lowStock: 'only a few left',
    preorder: 'available to pre-order',
    outOfStock: 'out of stock',
    bears: 'bears in about {years} years',
    shade: 'tolerates shade',
    nitrogen: 'fixes nitrogen',
    fitGood: 'suits {district}',
    fitOk: 'grows in {district} with irrigation',
    fitPoor: 'may struggle in {district}',
    qtyForArea: 'about {qty} for {acres} acres at {spacing} ft spacing',
  },
  /** Words the rules engine listens for. Lowercase; matched as whole words or phrases. */
  lexicon: {
    bulk: ['bulk', 'wholesale', 'tier', 'tiers', 'quantity discount'],
    delivery: ['deliver', 'delivery', 'shipping', 'ship', 'transport', 'courier', 'pincode'],
    returns: ['return', 'returns', 'refund', 'replace', 'replacement', 'cancel'],
    shade: ['shade', 'shady', 'partial sun', 'partial shade', 'low light'],
    stock: ['in stock', 'available now', 'availability', 'stock'],
    companions: ['grow with', 'grows with', 'grow well with', 'grows well with', 'goes well with', 'grow together', 'grows well together', 'companion', 'companions', 'intercrop', 'along with', 'already have', 'already grow', 'already planted', 'add to'],
    fit: ['grow in', 'grows in', 'suit', 'suits', 'suitable', 'my district', 'my area', 'my place', 'climate', 'my region'],
    greeting: ['hi', 'hello', 'hey', 'namaste', 'good morning', 'good evening'],
    nitrogen: ['nitrogen', 'nitrogen fixing', 'nitrogen fixer'],
    bearing: ['bear', 'bears', 'bearing', 'fruit', 'fruits', 'fruiting', 'yield'],
    offTopic: ['politics', 'election', 'cricket', 'movie', 'joke', 'weather today', 'stock market', 'bitcoin', 'homework', 'code'],
  },
  /** Words that follow a count of items in an answer ("40 saplings"); the validator checks those counts. */
  countWords: ['plants', 'plant', 'saplings', 'sapling', 'trees', 'tree', 'seedlings', 'units', 'pieces', 'nos', 'bags', 'packs'],
};

export type AssistantMessages = typeof assistantMessages;
export type AssistantMessagesOverride = { [K in keyof AssistantMessages]?: Partial<AssistantMessages[K]> };

/** Section-level merge of a host override over the defaults. */
export function mergeAssistantMessages(override: AssistantMessagesOverride | undefined): AssistantMessages {
  if (!override) return assistantMessages;
  const out: Record<string, unknown> = { ...assistantMessages };
  for (const [section, value] of Object.entries(override)) {
    const base = (assistantMessages as Record<string, unknown>)[section];
    out[section] = base && typeof base === 'object' && !Array.isArray(base) && value ? { ...base, ...value } : value;
  }
  return out as AssistantMessages;
}

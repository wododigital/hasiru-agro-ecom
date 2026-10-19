/** Renders one escaped @graph (from `jsonLd().graph(nodes)`); nothing when there is no graph. */
export function JsonLdScript({ graph }: { graph: string | null | undefined }) {
  if (!graph) return null;
  // eslint-disable-next-line react/no-danger -- the graph is escaped JSON (escapeJsonLd), not markup
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: graph }} />;
}

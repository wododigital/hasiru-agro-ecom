import { Breadcrumbs, type Crumb } from '@ecomkit/ui';
import type { Block } from '../domain';
import type { CmsMessages } from '../messages';
import type { BlockContext } from '../server/render';
import { BlockList } from './blocks';

/**
 * A cms page: breadcrumbs, one h1 (the page title, or the first hero's heading on landing pages), then the blocks.
 */
export function PageView({ title, blocks, ctx, messages, crumbs, landing = false }: { title: string; blocks: readonly Block[]; ctx: BlockContext; messages: CmsMessages; crumbs: readonly Crumb[]; landing?: boolean }) {
  const heroIsH1 = landing && blocks.some((b) => b.type === 'hero');
  return (
    <main className="flex flex-col pb-12">
      {heroIsH1 ? null : (
        <header className="mx-auto flex w-full max-w-6xl flex-col gap-3 px-4 pt-6">
          <Breadcrumbs items={crumbs} />
          <h1 className="font-display text-4xl text-primary md:text-5xl">{title}</h1>
        </header>
      )}
      <BlockList blocks={blocks} ctx={ctx} messages={messages} heroIsH1={heroIsH1} />
    </main>
  );
}

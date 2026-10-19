import Link from 'next/link';
import { Badge, ImageWithFallback } from '@ecomkit/ui';
import { placesMessages, type PlacesMessages } from '../messages';
import type { ScoredFit } from '../domain';
import type { DistrictPlant } from '../server/plant-source';

export interface FitPlant {
  plant: DistrictPlant;
  fit: ScoredFit;
}

/** Plants that fit a district, best first. Server component; cards link to the plant page. */
export function DistrictPlantList({ plants, messages = placesMessages }: { plants: readonly FitPlant[]; messages?: PlacesMessages }) {
  return (
    <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {plants.map(({ plant, fit }) => (
        <li key={plant.sku} className="overflow-hidden rounded-lg border border-border bg-surface">
          <Link href={plant.path} className="block" data-cta={`district-plant-${plant.sku.toLowerCase()}`}>
            <ImageWithFallback image={plant.image ?? null} alt={plant.name} sizes="(min-width: 1024px) 320px, 50vw" className="aspect-4/3 w-full object-cover" />
            <div className="space-y-2 p-4">
              <h3 className="text-lg font-semibold text-primary">{plant.name}</h3>
              {plant.nameKn ? <p className="text-sm text-muted">{plant.nameKn}</p> : null}
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={fit.level === 'good' ? 'success' : 'warning'}>{messages.fit[fit.level]}</Badge>
                {fit.reasons
                  .filter((r) => r === 'fit.needs_irrigation' || r === 'fit.light_irrigation' || r === 'fit.native_crop')
                  .map((r) => (
                    <Badge key={r} tone="outline">
                      {messages.fit.reasons[r]}
                    </Badge>
                  ))}
              </div>
              {plant.priceLabel ? <p className="font-semibold">{plant.priceLabel}</p> : null}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

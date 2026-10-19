import { Chip } from '@ecomkit/ui';
import { format, placesMessages, type PlacesMessages } from '../messages';
import type { DistrictRow } from '../server/repo';

/** Climate numbers, soil, rivers and crops: the page's unique, data-driven section. Server component. */
export function DistrictFacts({ district, messages = placesMessages }: { district: DistrictRow; messages?: PlacesMessages }) {
  const m = messages.district;
  const stat = (label: string, value: string) => (
    <div className="rounded-md border border-border bg-surface p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 text-xl font-semibold text-primary">{value}</dd>
    </div>
  );
  return (
    <section aria-labelledby="climate-heading" className="space-y-4">
      <h2 id="climate-heading" className="font-display text-2xl text-primary">
        {format(m.climateHeading, { district: district.name })}
      </h2>
      <dl className="grid gap-3 sm:grid-cols-3">
        {stat(m.temperature, `${district.tempMin} to ${district.tempMax} C`)}
        {stat(m.humidity, `${district.humidityMin} to ${district.humidityMax} %`)}
        {stat(m.rainfall, `${Math.round(district.rainfallMm)} ${m.rainfallUnit}`)}
      </dl>
      {district.soilText ? (
        <p>
          <strong>{m.soilHeading}</strong> {district.soilText}
        </p>
      ) : null}
      {district.rivers.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <strong>{m.riversHeading}</strong>
          {district.rivers.map((r) => (
            <Chip key={r}>{r}</Chip>
          ))}
        </div>
      ) : null}
      {district.nativeCrops.length ? (
        <div className="flex flex-wrap items-center gap-2">
          <strong>{m.nativeCropsHeading}</strong>
          {district.nativeCrops.map((c) => (
            <Chip key={c}>{c}</Chip>
          ))}
        </div>
      ) : null}
    </section>
  );
}

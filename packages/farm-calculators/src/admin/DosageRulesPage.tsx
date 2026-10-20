import { requirePermission } from '@ecomkit/core/auth-context';
import { listProducts } from '@ecomkit/catalog/server';
import { Badge, Button, Checkbox, Input, Select, Table, TBody, Td, Th, THead, Tr } from '@ecomkit/ui';
import { AGE_BANDS, BASES, RULE_ROLES, UNITS, type DosageRule } from '../domain';
import { listDosageRulesFresh } from '../server/rules';
import { deleteRuleForm, saveRuleForm } from './actions';

const STATUS: Record<string, { tone: 'success' | 'warning' | 'danger'; text: string }> = {
  saved: { tone: 'success', text: 'Rule saved.' },
  deleted: { tone: 'success', text: 'Rule deleted.' },
  duplicate: { tone: 'warning', text: 'That input already has a rule for this basis, role and age. Edit the existing rule instead.' },
  invalid: { tone: 'danger', text: 'Check the values: amounts are zero or more and pack sizes above zero.' },
  forbidden: { tone: 'danger', text: 'You do not have permission to change dosage rules.' },
};

const BASIS_LABEL = { per_plant: 'Per plant', per_acre: 'Per acre' } as const;
const ROLE_LABEL = { M: 'M (main)', X: 'X (host)', O: 'O (biomass)', any: 'Any role' } as const;
const AGE_LABEL = { at_planting: 'At planting', y0_2: '0 to 2 years', y3_6: '3 to 6 years', y7_plus: '7+ years' } as const;

function Options<T extends string>({ values, labels }: { values: readonly T[]; labels?: Record<T, string> }) {
  return values.map((v) => (
    <option key={v} value={v}>
      {labels?.[v] ?? v}
    </option>
  ));
}

/** The editable fields of one rule (shared by the row editor and the add form). */
function RuleFields({ rule }: { rule?: DosageRule & { id: string } }) {
  return (
    <>
      <Select name="basis" defaultValue={rule?.basis ?? 'per_plant'} aria-label="Basis" className="w-28">
        <Options values={BASES} labels={BASIS_LABEL} />
      </Select>
      <Select name="role" defaultValue={rule?.role ?? 'any'} aria-label="Role" className="w-32">
        <Options values={RULE_ROLES} labels={ROLE_LABEL} />
      </Select>
      <Select name="ageBand" defaultValue={rule?.ageBand ?? 'at_planting'} aria-label="Plant age" className="w-32">
        <Options values={AGE_BANDS} labels={AGE_LABEL} />
      </Select>
      <Input name="amount" type="number" step="0.001" min="0" required defaultValue={rule?.amount ?? ''} aria-label="Amount" className="w-24" />
      <Select name="unit" defaultValue={rule?.unit ?? 'kg'} aria-label="Unit" className="w-20">
        <Options values={UNITS} />
      </Select>
      <Input name="packSize" type="number" step="0.001" min="0.001" required defaultValue={rule?.packSize ?? ''} aria-label="Pack size" className="w-24" />
      <Input name="minPacks" type="number" step="1" min="0" defaultValue={rule?.minPacks ?? 0} aria-label="Minimum packs" className="w-20" />
      <Input name="position" type="number" step="1" min="0" defaultValue={rule?.position ?? 0} aria-label="Order" className="w-20" />
      <label className="flex items-center gap-1.5 text-xs">
        <Checkbox name="usePlantCompost" defaultChecked={rule?.usePlantCompost ?? false} />
        Use plant compost kg
      </label>
      <label className="flex items-center gap-1.5 text-xs">
        <Checkbox name="isActive" defaultChecked={rule?.isActive ?? true} />
        Active
      </label>
    </>
  );
}

/** Admin > Products > Dosage rules: how much of each input a plant (by role and age) or an acre needs. */
export default async function DosageRulesPage({ searchParams }: { searchParams?: Promise<Record<string, string | string[] | undefined>> }) {
  await requirePermission('products.read');
  const sp = (await searchParams) ?? {};
  const status = typeof sp.status === 'string' ? STATUS[sp.status] : undefined;
  const [rules, { rows: inputs }] = await Promise.all([listDosageRulesFresh(), listProducts({ kind: 'input', sort: 'name', limit: 1000 })]);
  const names = new Map(inputs.map((i) => [i.id, i.name]));
  const groups = new Map<string, (DosageRule & { id: string })[]>();
  for (const r of rules) groups.set(r.inputProductId, [...(groups.get(r.inputProductId) ?? []), r]);

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <h1 className="text-2xl font-semibold">Dosage rules</h1>
        <p className="max-w-3xl text-sm text-muted">
          Per plant: kg or litres for each plant of a role (M main, X host, O biomass; Any applies when no exact role rule exists). Per acre: amount per acre of land. Packs are rounded up and never fall below the minimum. These rules drive the compost calculator, the recommended inputs on planting plans and the inputs suggestion in the cart.
        </p>
      </div>
      {status ? <Badge tone={status.tone}>{status.text}</Badge> : null}

      {groups.size === 0 ? <p className="text-sm text-muted">No rules yet. Add one below, or run the seed to import the dosage data on input products.</p> : null}
      {[...groups].map(([inputId, list]) => (
        <section key={inputId} className="space-y-2">
          <h2 className="text-lg font-semibold">
            {names.get(inputId) ?? 'Hidden or deleted input'} <span className="text-xs font-normal text-muted">{inputId}</span>
          </h2>
          <Table>
            <THead>
              <Tr>
                <Th>Rule</Th>
                <Th>Actions</Th>
              </Tr>
            </THead>
            <TBody>
              {list.map((r) => (
                <Tr key={r.id}>
                  <Td>
                    <form action={saveRuleForm} id={`rule-${r.id}`} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="id" value={r.id} />
                      <input type="hidden" name="inputProductId" value={r.inputProductId} />
                      <RuleFields rule={r} />
                    </form>
                  </Td>
                  <Td>
                    <div className="flex gap-2">
                      <Button type="submit" form={`rule-${r.id}`} size="sm" variant="outline">
                        Save
                      </Button>
                      <form action={deleteRuleForm}>
                        <input type="hidden" name="id" value={r.id} />
                        <Button type="submit" size="sm" variant="ghost">
                          Delete
                        </Button>
                      </form>
                    </div>
                  </Td>
                </Tr>
              ))}
            </TBody>
          </Table>
        </section>
      ))}

      <section className="space-y-2 rounded-lg border border-border p-4">
        <h2 className="text-lg font-semibold">Add a rule</h2>
        <form action={saveRuleForm} className="flex flex-wrap items-center gap-2">
          <Select name="inputProductId" required aria-label="Input product" className="w-56" defaultValue="">
            <option value="" disabled>
              Choose an input
            </option>
            {inputs.map((i) => (
              <option key={i.id} value={i.id}>
                {i.name}
              </option>
            ))}
          </Select>
          <RuleFields />
          <Button type="submit" size="sm">
            Add rule
          </Button>
        </form>
      </section>
    </div>
  );
}

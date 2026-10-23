// The Skarbiec items Weles's services read with their own scoped consumers,
// each with the fields its credential holds and, for a service Weles writes,
// the kind its item is stored as: services.json beside this module, the one
// catalog the TypeScript runtime and the trajectories both read.

import declared from './services.json';

type Schema = keyof typeof declared.schemas;

export type ServiceContract = {
  consumer: string;
  item: string;
  fields: Readonly<Record<string, true>>;
  kind?: string;
};

type DeclaredService = {
  consumer: string;
  item: string;
  schema: string;
  kind?: string;
};

function contractOf(name: string, service: DeclaredService): ServiceContract {
  if (!Object.hasOwn(declared.schemas, service.schema))
    throw new Error(
      `services.json: ${name} names the schema ${service.schema}, which the catalog does not declare`,
    );
  const fields = declared.schemas[service.schema as Schema] as Record<
    string,
    true
  >;
  return Object.freeze({
    consumer: service.consumer,
    item: service.item,
    fields: Object.freeze({ ...fields }),
    ...(service.kind ? { kind: service.kind } : {}),
  });
}

export const SERVICE_CONTRACTS: Readonly<
  Record<keyof typeof declared.services, ServiceContract>
> = Object.freeze(
  Object.fromEntries(
    Object.entries(declared.services).map(([name, service]) => [
      name,
      contractOf(name, service),
    ]),
  ) as Record<keyof typeof declared.services, ServiceContract>,
);

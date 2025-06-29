/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import SuperTest from 'supertest';
import expect from '@kbn/expect';
import {
  ELASTIC_HTTP_VERSION_HEADER,
  X_ELASTIC_INTERNAL_ORIGIN_REQUEST,
} from '@kbn/core-http-common';
import {
  ASSET_CRITICALITY_PUBLIC_URL,
  ASSET_CRITICALITY_PUBLIC_CSV_UPLOAD_URL,
  ASSET_CRITICALITY_PUBLIC_LIST_URL,
  ASSET_CRITICALITY_INTERNAL_STATUS_URL,
  ASSET_CRITICALITY_INTERNAL_PRIVILEGES_URL,
  API_VERSIONS,
  ASSET_CRITICALITY_PUBLIC_BULK_UPLOAD_URL,
} from '@kbn/security-solution-plugin/common/constants';
import type {
  AssetCriticalityRecord,
  CreateAssetCriticalityRecord,
  FindAssetCriticalityRecordsRequestQuery,
} from '@kbn/security-solution-plugin/common/api/entity_analytics';
import type { Client } from '@elastic/elasticsearch';
import type { ToolingLog } from '@kbn/tooling-log';
import querystring from 'querystring';
import { SupertestWithoutAuthProviderType } from '@kbn/ftr-common-functional-services';
import { IndicesIndexSettings, MappingTypeMapping } from '@elastic/elasticsearch/lib/api/types';
import { routeWithNamespace, waitFor } from '../../../../common/utils/security_solution';

export const getAssetCriticalityIndex = (namespace?: string) =>
  `.asset-criticality.asset-criticality-${namespace ?? 'default'}`;

export const cleanAssetCriticality = async ({
  log,
  es,
  namespace = 'default',
}: {
  log: ToolingLog;
  es: Client;
  namespace?: string;
}) => {
  try {
    await Promise.allSettled([
      es.indices.delete({
        index: [getAssetCriticalityIndex(namespace)],
      }),
    ]);
  } catch (e) {
    log.warning(`Error deleting asset criticality index: ${e.message}`);
  }
};

export const getAssetCriticalityDoc = async (opts: {
  es: Client;
  idField: string;
  idValue: string;
}): Promise<AssetCriticalityRecord | undefined> => {
  const { es, idField, idValue } = opts;
  try {
    const doc = await es.get({
      index: getAssetCriticalityIndex(),
      id: `${idField}:${idValue}`,
    });

    return doc._source as AssetCriticalityRecord;
  } catch (e) {
    return undefined;
  }
};

export const assetCriticalityRouteHelpersFactory = (
  supertest: SuperTest.Agent,
  namespace?: string
) => ({
  status: async () =>
    await supertest
      .get(routeWithNamespace(ASSET_CRITICALITY_INTERNAL_STATUS_URL, namespace))
      .set('kbn-xsrf', 'true')
      .set(ELASTIC_HTTP_VERSION_HEADER, API_VERSIONS.internal.v1)
      .set(X_ELASTIC_INTERNAL_ORIGIN_REQUEST, 'kibana')
      .send()
      .expect(200),
  upsert: async (
    body: Record<string, unknown>,
    { expectStatusCode }: { expectStatusCode: number } = { expectStatusCode: 200 }
  ) => {
    const response = await supertest
      .post(routeWithNamespace(ASSET_CRITICALITY_PUBLIC_URL, namespace))
      .set('kbn-xsrf', 'true')
      .set(ELASTIC_HTTP_VERSION_HEADER, API_VERSIONS.public.v1)
      .set(X_ELASTIC_INTERNAL_ORIGIN_REQUEST, 'kibana')
      .send(body);

    if (response.status !== expectStatusCode) {
      // eslint-disable-next-line no-console
      console.log(`Unexpected status code: ${response.status}. Response body:`, response.body);
    }

    expect(response.status).equal(expectStatusCode);
    return response;
  },
  delete: async (
    idField: string,
    idValue: string,
    { expectStatusCode }: { expectStatusCode: number } = { expectStatusCode: 200 }
  ) => {
    const qs = querystring.stringify({ id_field: idField, id_value: idValue });
    const route = `${routeWithNamespace(ASSET_CRITICALITY_PUBLIC_URL, namespace)}?${qs}`;
    return supertest
      .delete(route)
      .set('kbn-xsrf', 'true')
      .set(ELASTIC_HTTP_VERSION_HEADER, API_VERSIONS.public.v1)
      .set(X_ELASTIC_INTERNAL_ORIGIN_REQUEST, 'kibana')
      .expect(expectStatusCode);
  },
  get: async (
    idField: string,
    idValue: string,
    { expectStatusCode }: { expectStatusCode: number } = { expectStatusCode: 200 }
  ) => {
    const qs = querystring.stringify({ id_field: idField, id_value: idValue });
    const route = `${routeWithNamespace(ASSET_CRITICALITY_PUBLIC_URL, namespace)}?${qs}`;
    return supertest
      .get(route)
      .set('kbn-xsrf', 'true')
      .set(ELASTIC_HTTP_VERSION_HEADER, API_VERSIONS.public.v1)
      .set(X_ELASTIC_INTERNAL_ORIGIN_REQUEST, 'kibana')
      .expect(expectStatusCode);
  },
  bulkUpload: async (
    records: CreateAssetCriticalityRecord[],
    { expectStatusCode }: { expectStatusCode: number } = { expectStatusCode: 200 }
  ) => {
    return supertest
      .post(routeWithNamespace(ASSET_CRITICALITY_PUBLIC_BULK_UPLOAD_URL, namespace))
      .set('kbn-xsrf', 'true')
      .set(ELASTIC_HTTP_VERSION_HEADER, API_VERSIONS.public.v1)
      .set(X_ELASTIC_INTERNAL_ORIGIN_REQUEST, 'kibana')
      .send({ records })
      .expect(expectStatusCode);
  },
  uploadCsv: async (
    fileContent: string | Buffer,
    { expectStatusCode }: { expectStatusCode: number } = { expectStatusCode: 200 }
  ) => {
    const file = fileContent instanceof Buffer ? fileContent : Buffer.from(fileContent);
    return supertest
      .post(routeWithNamespace(ASSET_CRITICALITY_PUBLIC_CSV_UPLOAD_URL, namespace))
      .set('kbn-xsrf', 'true')
      .set(ELASTIC_HTTP_VERSION_HEADER, API_VERSIONS.public.v1)
      .set(X_ELASTIC_INTERNAL_ORIGIN_REQUEST, 'kibana')
      .attach('file', file, { filename: 'asset_criticality.csv' })
      .expect(expectStatusCode);
  },
  list: async (
    opts: FindAssetCriticalityRecordsRequestQuery = {},
    { expectStatusCode }: { expectStatusCode: number } = { expectStatusCode: 200 }
  ) => {
    const qs = querystring.stringify(opts);
    const route = `${routeWithNamespace(ASSET_CRITICALITY_PUBLIC_LIST_URL, namespace)}?${qs}`;
    return supertest
      .get(route)
      .set('kbn-xsrf', 'true')
      .set(ELASTIC_HTTP_VERSION_HEADER, API_VERSIONS.public.v1)
      .set(X_ELASTIC_INTERNAL_ORIGIN_REQUEST, 'kibana')
      .expect(expectStatusCode);
  },
});

export const assetCriticalityRouteHelpersFactoryNoAuth = (
  supertestWithoutAuth: SupertestWithoutAuthProviderType,
  namespace?: string
) => ({
  privilegesForUser: async ({ username, password }: { username: string; password: string }) =>
    await supertestWithoutAuth
      .get(ASSET_CRITICALITY_INTERNAL_PRIVILEGES_URL)
      .auth(username, password)
      .set('elastic-api-version', API_VERSIONS.internal.v1)
      .set(X_ELASTIC_INTERNAL_ORIGIN_REQUEST, 'kibana')
      .send()
      .expect(200),
});

/**
 * Function to read asset criticality records from ES. By default, it reads from the asset criticality index in the default space, but this can be overridden with the
 * `index` parameter.
 *
 * @param {string[]} index - the index or indices to read criticality from.
 * @param {number} size - the size parameter of the query
 */
export const readAssetCriticality = async (
  es: Client,
  index: string[] = [getAssetCriticalityIndex()],
  size: number = 1000
): Promise<AssetCriticalityRecord[]> => {
  const results = await es.search({
    index,
    size,
  });
  return results.hits.hits.map((hit) => hit._source as AssetCriticalityRecord);
};

export const createAssetCriticalityRecords = async (
  records: CreateAssetCriticalityRecord[],
  es: Client
) => {
  const operations = records.flatMap((record) => [
    {
      index: {
        _index: getAssetCriticalityIndex(),
        _id: `${record.id_field}:${record.id_value}`,
      },
    },
    record,
  ]);

  const res = await es.bulk({
    operations,
    refresh: 'wait_for',
  });

  if (res.errors) {
    throw new Error(`Error creating asset criticality: ${JSON.stringify(res)}`);
  }

  return res;
};

/**
 * Function to read asset criticality from ES and wait for them to be
 * present/readable. By default, it reads from the asset criticality index in the
 * default space, but this can be overridden with the `index` parameter.
 *
 * @param {string[]} index - the index or indices to read asset criticality from.
 * @param {number} docCount - the number of asset criticality docs to wait for. Defaults to 1.
 */
export const waitForAssetCriticalityToBePresent = async ({
  es,
  log,
  index = [getAssetCriticalityIndex()],
  docCount = 1,
}: {
  es: Client;
  log: ToolingLog;
  index?: string[];
  docCount?: number;
}): Promise<void> => {
  await waitFor(
    async () => {
      const criticalities = await readAssetCriticality(es, index, docCount + 10);
      return criticalities.length >= docCount;
    },
    'waitForAssetCriticalityToBePresent',
    log
  );
};

export const getAssetCriticalityMappingAndSettings = async (
  es: Client,
  space = 'default'
): Promise<{ mappings?: MappingTypeMapping; settings?: IndicesIndexSettings | undefined }> => {
  const index = getAssetCriticalityIndex(space);
  const indexInfo = await es.indices.get({
    index,
  });
  return {
    mappings: indexInfo[index]?.mappings,
    settings: indexInfo[index]?.settings,
  };
};

export const getAssetCriticalityIndexVersion = async ({
  es,
  space = 'default',
}: {
  es: Client;
  space?: string;
}): Promise<number | undefined> => {
  const { mappings } = await getAssetCriticalityMappingAndSettings(es, space);
  return mappings?._meta?.version;
};

export const setAssetCriticalityIndexVersion = async ({
  es,
  version,
  space = 'default',
}: {
  es: Client;
  version: number;
  space?: string;
}): Promise<void> => {
  const index = getAssetCriticalityIndex(space);
  await es.indices.putMapping({
    index,
    _meta: {
      version,
    },
  });
};

/**
 * Function to get an asset criticality record from ES by its ID.
 * Only use this if you wish to see the document as it is stored in ES.
 * If you want to use the asset criticality record in your tests, use the
 * API helper `get` instead.
 */
export const getAssetCriticalityEsDocument = async ({
  es,
  idField,
  idValue,
  space = 'default',
}: {
  es: Client;
  idField: string;
  idValue: string;
  space?: string;
}): Promise<AssetCriticalityRecord | undefined> => {
  const index = getAssetCriticalityIndex(space);
  try {
    const doc = await es.get({
      index,
      id: `${idField}:${idValue}`,
    });

    return doc._source as AssetCriticalityRecord;
  } catch (e) {
    return undefined;
  }
};

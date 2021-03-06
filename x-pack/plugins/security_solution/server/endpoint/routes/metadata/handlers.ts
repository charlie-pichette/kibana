/*
 * Copyright Elasticsearch B.V. and/or licensed to Elasticsearch B.V. under one
 * or more contributor license agreements. Licensed under the Elastic License
 * 2.0; you may not use this file except in compliance with the Elastic License
 * 2.0.
 */

import Boom from '@hapi/boom';

import { TypeOf } from '@kbn/config-schema';
import {
  IScopedClusterClient,
  Logger,
  RequestHandler,
  SavedObjectsClientContract,
} from '../../../../../../../src/core/server';
import {
  HostInfo,
  HostMetadata,
  HostMetaDataInfo,
  HostResultList,
  HostStatus,
  MetadataQueryStrategyVersions,
} from '../../../../common/endpoint/types';
import type { SecuritySolutionRequestHandlerContext } from '../../../types';

import { getESQueryHostMetadataByID, kibanaRequestToMetadataListESQuery } from './query_builders';
import { Agent, AgentStatus, PackagePolicy } from '../../../../../fleet/common/types/models';
import { AgentNotFoundError } from '../../../../../fleet/server';
import { EndpointAppContext, HostListQueryResult } from '../../types';
import { GetMetadataListRequestSchema, GetMetadataRequestSchema } from './index';
import { findAllUnenrolledAgentIds } from './support/unenroll';
import { findAgentIDsByStatus } from './support/agent_status';
import { EndpointAppContextService } from '../../endpoint_app_context_services';

export interface MetadataRequestContext {
  esClient?: IScopedClusterClient;
  endpointAppContextService: EndpointAppContextService;
  logger: Logger;
  requestHandlerContext?: SecuritySolutionRequestHandlerContext;
  savedObjectsClient?: SavedObjectsClientContract;
}

const HOST_STATUS_MAPPING = new Map<AgentStatus, HostStatus>([
  ['online', HostStatus.HEALTHY],
  ['offline', HostStatus.OFFLINE],
  ['inactive', HostStatus.INACTIVE],
  ['unenrolling', HostStatus.UPDATING],
  ['enrolling', HostStatus.UPDATING],
  ['updating', HostStatus.UPDATING],
  ['warning', HostStatus.UNHEALTHY],
  ['error', HostStatus.UNHEALTHY],
  ['degraded', HostStatus.UNHEALTHY],
]);

/**
 * 00000000-0000-0000-0000-000000000000 is initial Elastic Agent id sent by Endpoint before policy is configured
 * 11111111-1111-1111-1111-111111111111 is Elastic Agent id sent by Endpoint when policy does not contain an id
 */

const IGNORED_ELASTIC_AGENT_IDS = [
  '00000000-0000-0000-0000-000000000000',
  '11111111-1111-1111-1111-111111111111',
];

export const getLogger = (endpointAppContext: EndpointAppContext): Logger => {
  return endpointAppContext.logFactory.get('metadata');
};

export const getMetadataListRequestHandler = function (
  endpointAppContext: EndpointAppContext,
  logger: Logger,
  queryStrategyVersion?: MetadataQueryStrategyVersions
): RequestHandler<
  unknown,
  unknown,
  TypeOf<typeof GetMetadataListRequestSchema.body>,
  SecuritySolutionRequestHandlerContext
> {
  return async (context, request, response) => {
    const agentService = endpointAppContext.service.getAgentService();
    if (agentService === undefined) {
      throw new Error('agentService not available');
    }

    const metadataRequestContext: MetadataRequestContext = {
      esClient: context.core.elasticsearch.client,
      endpointAppContextService: endpointAppContext.service,
      logger,
      requestHandlerContext: context,
      savedObjectsClient: context.core.savedObjects.client,
    };

    const unenrolledAgentIds = await findAllUnenrolledAgentIds(
      agentService,
      endpointAppContext.service.getPackagePolicyService()!,
      context.core.savedObjects.client,
      context.core.elasticsearch.client.asCurrentUser
    );

    const statusIDs = request?.body?.filters?.host_status?.length
      ? await findAgentIDsByStatus(
          agentService,
          context.core.savedObjects.client,
          context.core.elasticsearch.client.asCurrentUser,
          request.body?.filters?.host_status
        )
      : undefined;

    const queryStrategy = await endpointAppContext.service
      ?.getMetadataService()
      ?.queryStrategy(context.core.savedObjects.client, queryStrategyVersion);

    const queryParams = await kibanaRequestToMetadataListESQuery(
      request,
      endpointAppContext,
      queryStrategy!,
      {
        unenrolledAgentIds: unenrolledAgentIds.concat(IGNORED_ELASTIC_AGENT_IDS),
        statusAgentIDs: statusIDs,
      }
    );

    const result = await context.core.elasticsearch.client.asCurrentUser.search<HostMetadata>(
      queryParams
    );
    const hostListQueryResult = queryStrategy!.queryResponseToHostListResult(result.body);
    return response.ok({
      body: await mapToHostResultList(queryParams, hostListQueryResult, metadataRequestContext),
    });
  };
};

export const getMetadataRequestHandler = function (
  endpointAppContext: EndpointAppContext,
  logger: Logger,
  queryStrategyVersion?: MetadataQueryStrategyVersions
): RequestHandler<
  TypeOf<typeof GetMetadataRequestSchema.params>,
  unknown,
  unknown,
  SecuritySolutionRequestHandlerContext
> {
  return async (context, request, response) => {
    const agentService = endpointAppContext.service.getAgentService();
    if (agentService === undefined) {
      throw new Error('agentService not available');
    }

    const metadataRequestContext: MetadataRequestContext = {
      esClient: context.core.elasticsearch.client,
      endpointAppContextService: endpointAppContext.service,
      logger,
      requestHandlerContext: context,
      savedObjectsClient: context.core.savedObjects.client,
    };

    try {
      const doc = await getHostData(
        metadataRequestContext,
        request?.params?.id,
        queryStrategyVersion
      );
      if (doc) {
        return response.ok({ body: doc });
      }
      return response.notFound({ body: 'Endpoint Not Found' });
    } catch (err) {
      logger.warn(JSON.stringify(err, null, 2));
      if (err.isBoom) {
        return response.customError({
          statusCode: err.output.statusCode,
          body: { message: err.message },
        });
      }
      throw err;
    }
  };
};

export async function getHostMetaData(
  metadataRequestContext: MetadataRequestContext,
  id: string,
  queryStrategyVersion?: MetadataQueryStrategyVersions
): Promise<HostMetaDataInfo | undefined> {
  if (
    !metadataRequestContext.esClient &&
    !metadataRequestContext.requestHandlerContext?.core.elasticsearch.client
  ) {
    throw Boom.badRequest('esClient not found');
  }

  if (
    !metadataRequestContext.savedObjectsClient &&
    !metadataRequestContext.requestHandlerContext?.core.savedObjects
  ) {
    throw Boom.badRequest('savedObjectsClient not found');
  }

  const esClient = (metadataRequestContext?.esClient ??
    metadataRequestContext.requestHandlerContext?.core.elasticsearch
      .client) as IScopedClusterClient;

  const esSavedObjectClient =
    metadataRequestContext?.savedObjectsClient ??
    (metadataRequestContext.requestHandlerContext?.core.savedObjects
      .client as SavedObjectsClientContract);

  const queryStrategy = await metadataRequestContext.endpointAppContextService
    ?.getMetadataService()
    ?.queryStrategy(esSavedObjectClient, queryStrategyVersion);
  const query = getESQueryHostMetadataByID(id, queryStrategy!);

  const response = await esClient.asCurrentUser.search<HostMetadata>(query);

  const hostResult = queryStrategy!.queryResponseToHostResult(response.body);

  const hostMetadata = hostResult.result;
  if (!hostMetadata) {
    return undefined;
  }

  return { metadata: hostMetadata, query_strategy_version: hostResult.queryStrategyVersion };
}

export async function getHostData(
  metadataRequestContext: MetadataRequestContext,
  id: string,
  queryStrategyVersion?: MetadataQueryStrategyVersions
): Promise<HostInfo | undefined> {
  if (!metadataRequestContext.savedObjectsClient) {
    throw Boom.badRequest('savedObjectsClient not found');
  }

  if (
    !metadataRequestContext.esClient &&
    !metadataRequestContext.requestHandlerContext?.core.elasticsearch.client
  ) {
    throw Boom.badRequest('esClient not found');
  }

  const hostResult = await getHostMetaData(metadataRequestContext, id, queryStrategyVersion);

  if (!hostResult) {
    return undefined;
  }

  const agent = await findAgent(metadataRequestContext, hostResult.metadata);

  if (agent && !agent.active) {
    throw Boom.badRequest('the requested endpoint is unenrolled');
  }

  const metadata = await enrichHostMetadata(
    hostResult.metadata,
    metadataRequestContext,
    hostResult.query_strategy_version
  );

  return { ...metadata, query_strategy_version: hostResult.query_strategy_version };
}

async function findAgent(
  metadataRequestContext: MetadataRequestContext,
  hostMetadata: HostMetadata
): Promise<Agent | undefined> {
  try {
    if (
      !metadataRequestContext.esClient &&
      !metadataRequestContext.requestHandlerContext?.core.elasticsearch.client
    ) {
      throw new Error('esClient not found');
    }

    const esClient = (metadataRequestContext?.esClient ??
      metadataRequestContext.requestHandlerContext?.core.elasticsearch
        .client) as IScopedClusterClient;

    return await metadataRequestContext.endpointAppContextService
      ?.getAgentService()
      ?.getAgent(esClient.asCurrentUser, hostMetadata.elastic.agent.id);
  } catch (e) {
    if (e instanceof AgentNotFoundError) {
      metadataRequestContext.logger.warn(
        `agent with id ${hostMetadata.elastic.agent.id} not found`
      );
      return undefined;
    } else {
      throw e;
    }
  }
}

export async function mapToHostResultList(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryParams: Record<string, any>,
  hostListQueryResult: HostListQueryResult,
  metadataRequestContext: MetadataRequestContext
): Promise<HostResultList> {
  const totalNumberOfHosts = hostListQueryResult.resultLength;
  if ((hostListQueryResult.resultList?.length ?? 0) > 0) {
    return {
      request_page_size: queryParams.size,
      request_page_index: queryParams.from,
      hosts: await Promise.all(
        hostListQueryResult.resultList.map(async (entry) =>
          enrichHostMetadata(
            entry,
            metadataRequestContext,
            hostListQueryResult.queryStrategyVersion
          )
        )
      ),
      total: totalNumberOfHosts,
      query_strategy_version: hostListQueryResult.queryStrategyVersion,
    };
  } else {
    return {
      request_page_size: queryParams.size,
      request_page_index: queryParams.from,
      total: totalNumberOfHosts,
      hosts: [],
      query_strategy_version: hostListQueryResult.queryStrategyVersion,
    };
  }
}

export async function enrichHostMetadata(
  hostMetadata: HostMetadata,
  metadataRequestContext: MetadataRequestContext,
  metadataQueryStrategyVersion: MetadataQueryStrategyVersions
): Promise<HostInfo> {
  let hostStatus = HostStatus.UNHEALTHY;
  let elasticAgentId = hostMetadata?.elastic?.agent?.id;
  const log = metadataRequestContext.logger;

  try {
    if (
      !metadataRequestContext.esClient &&
      !metadataRequestContext.requestHandlerContext?.core.elasticsearch.client
    ) {
      throw new Error('esClient not found');
    }

    if (
      !metadataRequestContext.savedObjectsClient &&
      !metadataRequestContext.requestHandlerContext?.core.savedObjects
    ) {
      throw new Error('esSavedObjectClient not found');
    }
  } catch (e) {
    log.error(e);
    throw e;
  }

  const esClient = (metadataRequestContext?.esClient ??
    metadataRequestContext.requestHandlerContext?.core.elasticsearch
      .client) as IScopedClusterClient;

  const esSavedObjectClient =
    metadataRequestContext?.savedObjectsClient ??
    (metadataRequestContext.requestHandlerContext?.core.savedObjects
      .client as SavedObjectsClientContract);

  try {
    /**
     * Get agent status by elastic agent id if available or use the endpoint-agent id.
     */

    if (!elasticAgentId) {
      elasticAgentId = hostMetadata.agent.id;
      log.warn(`Missing elastic agent id, using host id instead ${elasticAgentId}`);
    }

    const status = await metadataRequestContext.endpointAppContextService
      ?.getAgentService()
      ?.getAgentStatusById(esClient.asCurrentUser, elasticAgentId);
    hostStatus = HOST_STATUS_MAPPING.get(status!) || HostStatus.UNHEALTHY;
  } catch (e) {
    if (e instanceof AgentNotFoundError) {
      log.warn(`agent with id ${elasticAgentId} not found`);
    } else {
      log.error(e);
      throw e;
    }
  }

  let policyInfo: HostInfo['policy_info'];
  try {
    const agent = await metadataRequestContext.endpointAppContextService
      ?.getAgentService()
      ?.getAgent(esClient.asCurrentUser, elasticAgentId);
    const agentPolicy = await metadataRequestContext.endpointAppContextService
      .getAgentPolicyService()
      ?.get(esSavedObjectClient, agent?.policy_id!, true);
    const endpointPolicy = ((agentPolicy?.package_policies || []) as PackagePolicy[]).find(
      (policy: PackagePolicy) => policy.package?.name === 'endpoint'
    );

    policyInfo = {
      agent: {
        applied: {
          revision: agent?.policy_revision || 0,
          id: agent?.policy_id || '',
        },
        configured: {
          revision: agentPolicy?.revision || 0,
          id: agentPolicy?.id || '',
        },
      },
      endpoint: {
        revision: endpointPolicy?.revision || 0,
        id: endpointPolicy?.id || '',
      },
    };
  } catch (e) {
    // this is a non-vital enrichment of expected policy revisions.
    // if we fail just fetching these, the rest of the endpoint
    // data should still be returned. log the error and move on
    log.error(e);
  }

  return {
    metadata: hostMetadata,
    host_status: hostStatus,
    policy_info: policyInfo,
    query_strategy_version: metadataQueryStrategyVersion,
  };
}
